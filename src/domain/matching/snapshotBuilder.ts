/**
 * Build AuditSnapshot / MatchingInput from persisted normalized tables.
 * Phase 4 adapter — does not run rules or invent data.
 */
import { getDb } from '../../db/db.js';
import type {
  AuditSnapshot,
  WorkspaceSettings,
  ChangeOrder,
  ChangeOrderLine,
  ContractSOVLine,
  BillingItem,
  TMTicket,
  RateTableEntry,
  EvidenceRecord,
  EvidenceLink,
  Match,
  ChangeOrderStatus,
  ChangeMethod,
  RateType,
  RateBasis,
  ApprovalStatus,
  LaborRateType,
  BillableStatus,
  BillingExpected,
  BillingBasis,
  EvidenceType,
  ConfidenceLevel,
} from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { WorkspaceRepo } from '../../db/repos/workspaceRepo.js';
import { MatchRepo } from '../../db/repos/matchRepo.js';
import type { MatchingInput } from './matching.js';

function parseJson<T>(s: unknown, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return fallback;
  }
}

export async function loadMatchingInput(
  workspaceId: string,
  projectId: string,
): Promise<MatchingInput> {
  const db = await getDb();

  const changeOrders = loadChangeOrders(db, workspaceId, projectId);
  const billingItems = loadBilling(db, workspaceId, projectId);
  const tmTickets = loadTickets(db, workspaceId, projectId);
  const changeOrderLines = loadCoLines(db, workspaceId, projectId);

  return {
    projectId,
    workspaceId,
    changeOrders,
    billingItems,
    tmTickets,
    changeOrderLines,
  };
}

/**
 * Full snapshot for AuditEngine. Matching results loaded from matches table.
 */
export async function buildAuditSnapshot(
  workspaceId: string,
  projectId: string,
  asOfDate: string,
): Promise<AuditSnapshot> {
  const db = await getDb();
  const settingsRow = await WorkspaceRepo.getSettings(workspaceId);
  const settings: WorkspaceSettings = {
    workspaceId,
    materialityAbsolute: settingsRow.materialityAbsolute,
    materialityPct: settingsRow.materialityPct,
    roundingCurrency: settingsRow.roundingCurrency,
    roundingQuantity: settingsRow.roundingQuantity,
    billingGraceDays: settingsRow.billingGraceDays,
  };

  const matches = await MatchRepo.listByProject(workspaceId, projectId);

  return {
    projectId,
    workspaceId,
    asOfDate,
    settings,
    contractSovLines: loadSov(db, workspaceId, projectId),
    changeOrders: loadChangeOrders(db, workspaceId, projectId),
    changeOrderLines: loadCoLines(db, workspaceId, projectId),
    tmTickets: loadTickets(db, workspaceId, projectId),
    billingItems: loadBilling(db, workspaceId, projectId),
    rateTables: loadRates(db, workspaceId, projectId),
    evidenceRecords: loadEvidence(db, workspaceId, projectId),
    evidenceLinks: loadEvidenceLinks(db, workspaceId, projectId),
    matches,
  };
}

type SqlDb = Awaited<ReturnType<typeof getDb>>;

function loadChangeOrders(db: SqlDb, workspaceId: string, projectId: string): ChangeOrder[] {
  const stmt = db.prepare(
    `SELECT * FROM change_orders WHERE workspace_id = ? AND project_id = ?`,
  );
  stmt.bind([workspaceId, projectId]);
  const list: ChangeOrder[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      changeOrderId: String(r.change_order_id),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      status: r.status as ChangeOrderStatus,
      changeMethod: (r.change_method as ChangeMethod) ?? 'unknown',
      submittedDate: r.submitted_date != null ? String(r.submitted_date) : null,
      approvedDate: r.approved_date != null ? String(r.approved_date) : null,
      effectiveDate: r.effective_date != null ? String(r.effective_date) : null,
      originalAmount: Number(r.original_amount ?? 0),
      approvedAmount: Number(r.approved_amount ?? 0),
      customerReference: String(r.customer_reference ?? ''),
      costCode: String(r.cost_code ?? ''),
      expectedBillAfter: r.expected_bill_after != null ? String(r.expected_bill_after) : null,
      sourceReference: String(r.source_reference ?? ''),
    });
  }
  stmt.free();
  return list;
}

function loadBilling(db: SqlDb, workspaceId: string, projectId: string): BillingItem[] {
  const stmt = db.prepare(
    `SELECT * FROM billing_items WHERE workspace_id = ? AND project_id = ?`,
  );
  stmt.bind([workspaceId, projectId]);
  const list: BillingItem[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      billingId: String(r.billing_id),
      billingPeriod: String(r.billing_period ?? ''),
      invoiceNumber: String(r.invoice_number ?? ''),
      lineId: String(r.line_id),
      description: String(r.description ?? ''),
      costCode: String(r.cost_code ?? ''),
      changeOrderId: r.change_order_id != null ? String(r.change_order_id) : null,
      changeOrderLineNumber:
        r.change_order_line_number != null ? Number(r.change_order_line_number) : null,
      amount: Number(r.amount ?? 0),
      quantity: r.quantity != null ? Number(r.quantity) : null,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      unit: r.unit != null ? String(r.unit) : null,
      retainage: r.retainage != null ? Number(r.retainage) : null,
      billedToDate: r.billed_to_date != null ? Number(r.billed_to_date) : null,
      billingDate: r.billing_date != null ? String(r.billing_date) : null,
      sourceReference: String(r.source_reference ?? ''),
    });
  }
  stmt.free();
  return list;
}

function loadTickets(db: SqlDb, workspaceId: string, projectId: string): TMTicket[] {
  const stmt = db.prepare(`SELECT * FROM tm_tickets WHERE workspace_id = ? AND project_id = ?`);
  stmt.bind([workspaceId, projectId]);
  const list: TMTicket[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      ticketId: String(r.ticket_id),
      date: String(r.date),
      description: String(r.description ?? ''),
      workerOrCategory: String(r.worker_or_category ?? ''),
      laborHours: Number(r.labor_hours ?? 0),
      laborRate: Number(r.labor_rate ?? 0),
      laborRateType: (r.labor_rate_type as LaborRateType) ?? 'unknown',
      laborAmount: Number(r.labor_amount ?? 0),
      materialAmount: Number(r.material_amount ?? 0),
      equipmentAmount: Number(r.equipment_amount ?? 0),
      totalAmount: Number(r.total_amount ?? 0),
      approvalStatus: (r.approval_status as ApprovalStatus) ?? 'pending',
      customerSignature: Boolean(r.customer_signature),
      billableStatus: (r.billable_status as BillableStatus) ?? 'unknown',
      billingExpected: (r.billing_expected as BillingExpected) ?? 'unknown',
      billingBasis: (r.billing_basis as BillingBasis) ?? 'unknown',
      linkedChangeOrderId:
        r.linked_change_order_id != null ? String(r.linked_change_order_id) : null,
      expectedBillAfter: r.expected_bill_after != null ? String(r.expected_bill_after) : null,
      sourceReference: String(r.source_reference ?? ''),
    });
  }
  stmt.free();
  return list;
}

function loadCoLines(db: SqlDb, workspaceId: string, projectId: string): ChangeOrderLine[] {
  const stmt = db.prepare(
    `SELECT * FROM change_order_lines WHERE workspace_id = ? AND project_id = ?`,
  );
  stmt.bind([workspaceId, projectId]);
  const list: ChangeOrderLine[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      changeOrderId: String(r.change_order_id),
      lineNumber: Number(r.line_number),
      description: String(r.description ?? ''),
      costCode: r.cost_code != null ? String(r.cost_code) : null,
      quantity: Number(r.quantity),
      unit: String(r.unit),
      approvedUnitPrice: Number(r.approved_unit_price),
      approvedAmount: Number(r.approved_amount),
      rateType: (r.rate_type as RateType) ?? 'unknown',
      rateBasis: (r.rate_basis as RateBasis) ?? 'unit',
    });
  }
  stmt.free();
  return list;
}

function loadSov(db: SqlDb, workspaceId: string, projectId: string): ContractSOVLine[] {
  const stmt = db.prepare(
    `SELECT * FROM contract_sov_lines WHERE workspace_id = ? AND project_id = ?`,
  );
  stmt.bind([workspaceId, projectId]);
  const list: ContractSOVLine[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      contractId: String(r.contract_id),
      lineId: String(r.line_id),
      costCode: String(r.cost_code ?? ''),
      description: String(r.description ?? ''),
      originalAmount: Number(r.original_amount ?? 0),
      approvedRevisedAmount: Number(r.approved_revised_amount ?? 0),
      quantity: r.quantity != null ? Number(r.quantity) : null,
      unit: r.unit != null ? String(r.unit) : null,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      retainage: r.retainage != null ? Number(r.retainage) : null,
      sourceReference: String(r.source_reference ?? ''),
    });
  }
  stmt.free();
  return list;
}

function loadRates(db: SqlDb, workspaceId: string, projectId: string): RateTableEntry[] {
  const stmt = db.prepare(`SELECT * FROM rate_table WHERE workspace_id = ? AND project_id = ?`);
  stmt.bind([workspaceId, projectId]);
  const list: RateTableEntry[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      rateId: String(r.rate_id),
      rateType: r.rate_type as RateType,
      rateBasis: r.rate_basis as RateBasis,
      amount: Number(r.amount),
      effectiveFrom: String(r.effective_from),
      effectiveTo: r.effective_to != null ? String(r.effective_to) : null,
      description: String(r.description ?? ''),
    });
  }
  stmt.free();
  return list;
}

function loadEvidence(db: SqlDb, workspaceId: string, projectId: string): EvidenceRecord[] {
  const stmt = db.prepare(`SELECT * FROM evidence WHERE workspace_id = ? AND project_id = ?`);
  stmt.bind([workspaceId, projectId]);
  const list: EvidenceRecord[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      id: String(r.id),
      projectId: String(r.project_id),
      workspaceId: String(r.workspace_id),
      sourceDocumentId: String(r.source_document_id),
      sourceImportId: String(r.source_import_id),
      sourceRowOrPage: String(r.source_row_or_page),
      rawValues: parseJson(r.raw_values, {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      evidenceId: String(r.evidence_id),
      date: r.date != null ? String(r.date) : null,
      type: (r.type as EvidenceType) ?? 'other',
      description: String(r.description ?? ''),
      fileReference: String(r.file_reference ?? ''),
      pageReference: String(r.page_reference ?? ''),
      timestamp: r.timestamp != null ? String(r.timestamp) : null,
      confidence: (String(r.confidence ?? 'MEDIUM').toUpperCase() as ConfidenceLevel),
    });
  }
  stmt.free();
  return list;
}

/**
 * Only links whose evidence row belongs to the requested workspace+project.
 * Prevents cross-workspace evidence from entering an audit snapshot.
 */
function loadEvidenceLinks(
  db: SqlDb,
  workspaceId: string,
  projectId: string,
): EvidenceLink[] {
  const stmt = db.prepare(
    `SELECT el.evidence_id, el.entity_type, el.entity_id, el.relationship, el.confidence
     FROM evidence_links el
     WHERE el.workspace_id = ? AND el.project_id = ?`,
  );
  stmt.bind([workspaceId, projectId]);
  const list: EvidenceLink[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    list.push({
      evidenceId: String(r.evidence_id),
      entityType: r.entity_type as EvidenceLink['entityType'],
      entityId: String(r.entity_id),
      relationship: r.relationship as EvidenceLink['relationship'],
      confidence: String(r.confidence ?? 'MEDIUM').toUpperCase() as ConfidenceLevel,
    });
  }
  stmt.free();
  return list;
}

void DEFAULT_SETTINGS;
