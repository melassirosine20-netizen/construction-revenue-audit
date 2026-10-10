/**
 * Persistence for normalized financial entities — Phase 3
 * Spec: docs/02-data-model.md schema · docs/17-implementation-plan-v1.md § Phase 3
 *
 * Idempotency: re-committing the same import replaces entities with that source_import_id.
 * Cross-import duplicate business keys are NOT auto-merged (documented risk).
 * Writes run inside a sql.js transaction when possible.
 */
import { getDb, saveDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  ChangeOrder,
  ChangeOrderLine,
  ContractSOVLine,
  BillingItem,
  TMTicket,
  RateTableEntry,
  EvidenceRecord,
  EvidenceLink,
} from '../../domain/types.js';
import type { NormalizedEntity } from '../../domain/import/normalize.js';

type SqlDb = Awaited<ReturnType<typeof getDb>>;

const TABLE_BY_KIND: Record<string, string> = {
  change_order: 'change_orders',
  change_order_line: 'change_order_lines',
  contract_sov: 'contract_sov_lines',
  billing: 'billing_items',
  tm_ticket: 'tm_tickets',
  rate_table: 'rate_table',
  evidence: 'evidence',
};

function insertProvenanceColumns(entity: {
  id: string;
  projectId: string;
  workspaceId: string;
  sourceDocumentId: string;
  sourceImportId: string;
  sourceRowOrPage: string;
  rawValues: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}): unknown[] {
  return [
    entity.id,
    entity.projectId,
    entity.workspaceId,
    entity.sourceDocumentId,
    entity.sourceImportId,
    entity.sourceRowOrPage,
    JSON.stringify(entity.rawValues),
    entity.createdAt,
    entity.updatedAt,
  ];
}

export class NormalizedRepo {
  /**
   * Replace any prior rows for this import, then insert.
   * Runs in a transaction so a mid-batch failure does not leave a partial commit.
   */
  static async persistEntities(
    sourceImportId: string,
    entities: NormalizedEntity[],
  ): Promise<number> {
    const db = await getDb();
    const kinds = new Set(entities.map((e) => e.kind));

    try {
      db.run('BEGIN');

      // Idempotent re-commit: clear prior normalized rows for this import.
      // Evidence links must be removed BEFORE evidence rows (FK-style dependency).
      if (kinds.has('evidence')) {
        db.run(
          `DELETE FROM evidence_links WHERE workspace_id IN (
             SELECT workspace_id FROM evidence WHERE source_import_id = ?
           ) AND project_id IN (
             SELECT project_id FROM evidence WHERE source_import_id = ?
           ) AND evidence_id IN (
             SELECT evidence_id FROM evidence WHERE source_import_id = ?
           )`,
          [sourceImportId, sourceImportId, sourceImportId],
        );
      }
      for (const kind of kinds) {
        const table = TABLE_BY_KIND[kind];
        if (table) {
          db.run(`DELETE FROM ${table} WHERE source_import_id = ?`, [sourceImportId]);
        }
      }

      let count = 0;
      for (const item of entities) {
        switch (item.kind) {
          case 'change_order':
            insertChangeOrder(db, item.entity);
            count++;
            break;
          case 'change_order_line':
            insertChangeOrderLine(db, item.entity);
            count++;
            break;
          case 'contract_sov':
            insertContractSov(db, item.entity);
            count++;
            break;
          case 'billing':
            insertBilling(db, item.entity);
            count++;
            break;
          case 'tm_ticket':
            insertTmTicket(db, item.entity);
            count++;
            break;
          case 'rate_table':
            insertRateTable(db, item.entity);
            count++;
            break;
          case 'evidence':
            insertEvidence(db, item.entity);
            for (const link of item.links) {
              insertEvidenceLink(db, link, item.entity.workspaceId, item.entity.projectId);
            }
            count++;
            break;
        }
      }

      db.run('COMMIT');
      saveDb();
      return count;
    } catch (err) {
      try {
        db.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /**
   * Count entities in a project that share a business key with incoming values
   * but belong to a different import (cross-import duplicate risk signal).
   */
  static async countCrossImportDuplicates(
    projectId: string,
    sourceImportId: string,
    kind: string,
    businessKeys: string[],
  ): Promise<number> {
    if (businessKeys.length === 0) return 0;
    const db = await getDb();
    const table = TABLE_BY_KIND[kind];
    if (!table) return 0;

    const keyCol =
      kind === 'change_order'
        ? 'change_order_id'
        : kind === 'billing'
          ? 'billing_id'
          : kind === 'tm_ticket'
            ? 'ticket_id'
            : kind === 'rate_table'
              ? 'rate_id'
              : kind === 'evidence'
                ? 'evidence_id'
                : kind === 'contract_sov'
                  ? 'line_id'
                  : null;
    if (!keyCol) return 0;

    let count = 0;
    for (const key of businessKeys) {
      const stmt = db.prepare(
        `SELECT COUNT(*) as cnt FROM ${table}
         WHERE project_id = ? AND ${keyCol} = ? AND source_import_id != ?`,
      );
      stmt.bind([projectId, key, sourceImportId]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as { cnt: number };
        count += Number(row.cnt);
      }
      stmt.free();
    }
    return count;
  }
}

function insertChangeOrder(db: SqlDb, e: ChangeOrder): void {
  db.run(
    `INSERT INTO change_orders (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      change_order_id, title, description, status, change_method,
      submitted_date, approved_date, effective_date, original_amount, approved_amount,
      customer_reference, cost_code, expected_bill_after, source_reference, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.changeOrderId,
      e.title,
      e.description,
      e.status,
      e.changeMethod,
      e.submittedDate,
      e.approvedDate,
      e.effectiveDate,
      e.originalAmount,
      e.approvedAmount,
      e.customerReference,
      e.costCode,
      e.expectedBillAfter,
      e.sourceReference,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertChangeOrderLine(db: SqlDb, e: ChangeOrderLine): void {
  db.run(
    `INSERT INTO change_order_lines (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      change_order_id, line_number, description, cost_code, quantity, unit,
      approved_unit_price, approved_amount, rate_type, rate_basis, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.changeOrderId,
      e.lineNumber,
      e.description,
      e.costCode,
      e.quantity,
      e.unit,
      e.approvedUnitPrice,
      e.approvedAmount,
      e.rateType,
      e.rateBasis,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertContractSov(db: SqlDb, e: ContractSOVLine): void {
  db.run(
    `INSERT INTO contract_sov_lines (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      contract_id, line_id, cost_code, description, original_amount, approved_revised_amount,
      quantity, unit, unit_price, retainage, source_reference, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.contractId,
      e.lineId,
      e.costCode,
      e.description,
      e.originalAmount,
      e.approvedRevisedAmount,
      e.quantity,
      e.unit,
      e.unitPrice,
      e.retainage,
      e.sourceReference,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertBilling(db: SqlDb, e: BillingItem): void {
  db.run(
    `INSERT INTO billing_items (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      billing_id, billing_period, invoice_number, line_id, description, cost_code,
      change_order_id, change_order_line_number, amount, quantity, unit_price, unit,
      retainage, billed_to_date, billing_date, source_reference, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.billingId,
      e.billingPeriod,
      e.invoiceNumber,
      e.lineId,
      e.description,
      e.costCode,
      e.changeOrderId,
      e.changeOrderLineNumber,
      e.amount,
      e.quantity,
      e.unitPrice,
      e.unit,
      e.retainage,
      e.billedToDate,
      e.billingDate,
      e.sourceReference,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertTmTicket(db: SqlDb, e: TMTicket): void {
  db.run(
    `INSERT INTO tm_tickets (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      ticket_id, date, description, worker_or_category, labor_hours, labor_rate, labor_rate_type,
      labor_amount, material_amount, equipment_amount, total_amount, approval_status,
      customer_signature, billable_status, billing_expected, billing_basis,
      linked_change_order_id, expected_bill_after, source_reference, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.ticketId,
      e.date,
      e.description,
      e.workerOrCategory,
      e.laborHours,
      e.laborRate,
      e.laborRateType,
      e.laborAmount,
      e.materialAmount,
      e.equipmentAmount,
      e.totalAmount,
      e.approvalStatus,
      e.customerSignature ? 1 : 0,
      e.billableStatus,
      e.billingExpected,
      e.billingBasis,
      e.linkedChangeOrderId,
      e.expectedBillAfter,
      e.sourceReference,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertRateTable(db: SqlDb, e: RateTableEntry): void {
  db.run(
    `INSERT INTO rate_table (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      rate_id, rate_type, rate_basis, amount, effective_from, effective_to, description, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.rateId,
      e.rateType,
      e.rateBasis,
      e.amount,
      e.effectiveFrom,
      e.effectiveTo,
      e.description,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertEvidence(db: SqlDb, e: EvidenceRecord): void {
  db.run(
    `INSERT INTO evidence (
      id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values,
      evidence_id, date, type, description, file_reference, page_reference, timestamp, confidence, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ...insertProvenanceColumns(e).slice(0, 7),
      e.evidenceId,
      e.date,
      e.type,
      e.description,
      e.fileReference,
      e.pageReference,
      e.timestamp,
      e.confidence,
      e.createdAt,
      e.updatedAt,
    ],
  );
}

function insertEvidenceLink(
  db: SqlDb,
  link: EvidenceLink,
  workspaceId: string,
  projectId: string,
): void {
  db.run(
    `INSERT INTO evidence_links (
      id, workspace_id, project_id, evidence_id, entity_type, entity_id, relationship, confidence
    ) VALUES (?,?,?,?,?,?,?,?)`,
    [
      uuidv4(),
      workspaceId,
      projectId,
      link.evidenceId,
      link.entityType,
      link.entityId,
      link.relationship,
      link.confidence,
    ],
  );
}
