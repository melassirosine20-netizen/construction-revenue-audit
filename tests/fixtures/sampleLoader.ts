/**
 * Fixture loader — loads data/samples/*.csv into in-memory normalized records.
 * Used by oracle tests and unit tests. No DB required.
 * Spec: docs/17-implementation-plan-v1.md § E.1 Fixture loader
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type {
  AuditSnapshot,
  WorkspaceSettings,
  ContractSOVLine,
  ChangeOrder,
  ChangeOrderLine,
  TMTicket,
  BillingItem,
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
} from '../../src/domain/types.js';
import { DEFAULT_SETTINGS } from '../../src/domain/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SAMPLES_DIR = join(__dirname, '../../data/samples');

const WORKSPACE_ID = 'ws-test-001';
const PROJECT_ID = 'PRJ-METRO-EL';
const IMPORT_ID = 'import-test-001';
const DOC_ID = 'doc-test-001';

function makeProv(row: number, extra?: Record<string, unknown>): {
  id: string;
  projectId: string;
  workspaceId: string;
  sourceDocumentId: string;
  sourceImportId: string;
  sourceRowOrPage: string;
  rawValues: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: `fixture-${row}`,
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    sourceDocumentId: DOC_ID,
    sourceImportId: IMPORT_ID,
    sourceRowOrPage: String(row),
    rawValues: extra ?? {},
    createdAt: '2025-08-15T00:00:00Z',
    updatedAt: '2025-08-15T00:00:00Z',
  };
}

function readCsv(filename: string): Record<string, string>[] {
  const content = readFileSync(join(SAMPLES_DIR, filename), 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

function num(v: string | undefined): number {
  if (!v || v.trim() === '') return 0;
  return parseFloat(v.replace(/[,$]/g, ''));
}

function numOrNull(v: string | undefined): number | null {
  if (!v || v.trim() === '') return null;
  const n = parseFloat(v.replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

function strOrNull(v: string | undefined): string | null {
  if (!v || v.trim() === '') return null;
  return v.trim();
}

function boolFromStr(v: string | undefined): boolean {
  if (!v) return false;
  return v.toLowerCase() === 'true' || v === '1';
}

// ─── Loaders ──────────────────────────────────────────────────────────────────

export function loadContractSOV(): ContractSOVLine[] {
  return readCsv('contract_sov.csv').map((row, i) => ({
    ...makeProv(i + 1, row),
    contractId: row['contract_id'] ?? '',
    lineId: String(row['line_id'] ?? ''),  // Always string
    costCode: row['cost_code'] ?? '',
    description: row['description'] ?? '',
    originalAmount: num(row['original_amount']),
    approvedRevisedAmount: num(row['approved_revised_amount']),
    quantity: numOrNull(row['quantity']),
    unit: strOrNull(row['unit']),
    unitPrice: numOrNull(row['unit_price']),
    retainage: numOrNull(row['retainage']),
    sourceReference: row['source_reference'] ?? '',
  }));
}

export function loadChangeOrders(): ChangeOrder[] {
  return readCsv('change_orders.csv').map((row, i) => ({
    ...makeProv(i + 1, row),
    changeOrderId: row['change_order_id'] ?? '',
    title: row['title'] ?? '',
    description: row['description'] ?? '',
    status: (row['status'] ?? 'submitted') as ChangeOrderStatus,
    changeMethod: (row['change_method'] ?? 'unknown') as ChangeMethod,
    submittedDate: strOrNull(row['submitted_date']),
    approvedDate: strOrNull(row['approved_date']),
    effectiveDate: strOrNull(row['effective_date']),
    originalAmount: num(row['original_amount']),
    approvedAmount: num(row['approved_amount']),
    customerReference: row['customer_reference'] ?? '',
    costCode: row['cost_code'] ?? '',
    expectedBillAfter: strOrNull(row['expected_bill_after']),
    sourceReference: row['source_reference'] ?? '',
  }));
}

export function loadChangeOrderLines(): ChangeOrderLine[] {
  return readCsv('change_order_lines.csv').map((row, i) => ({
    ...makeProv(i + 1, row),
    changeOrderId: row['change_order_id'] ?? '',
    lineNumber: parseInt(row['line_number'] ?? '1', 10),
    description: row['description'] ?? '',
    costCode: strOrNull(row['cost_code']),
    quantity: num(row['quantity']),
    unit: row['unit'] ?? '',
    approvedUnitPrice: num(row['approved_unit_price']),
    approvedAmount: num(row['approved_amount']),
    rateType: (row['rate_type'] ?? 'unknown') as RateType,
    rateBasis: (row['rate_basis'] ?? 'lump_sum') as RateBasis,
  }));
}

export function loadTMTickets(): TMTicket[] {
  return readCsv('tm_tickets.csv').map((row, i) => ({
    ...makeProv(i + 1, row),
    ticketId: row['ticket_id'] ?? '',
    date: row['date'] ?? '',
    description: row['description'] ?? '',
    workerOrCategory: row['worker_or_category'] ?? '',
    laborHours: num(row['labor_hours']),
    laborRate: num(row['labor_rate']),
    laborRateType: (row['labor_rate_type'] ?? 'unknown') as LaborRateType,
    laborAmount: num(row['labor_amount']),
    materialAmount: num(row['material_amount']),
    equipmentAmount: num(row['equipment_amount']),
    totalAmount: num(row['total_amount']),
    approvalStatus: (row['approval_status'] ?? 'pending') as ApprovalStatus,
    customerSignature: boolFromStr(row['customer_signature']),
    billableStatus: (row['billable_status'] ?? 'unknown') as BillableStatus,
    billingExpected: (row['billing_expected'] ?? 'unknown') as BillingExpected,
    billingBasis: (row['billing_basis'] ?? 'unknown') as BillingBasis,
    linkedChangeOrderId: strOrNull(row['linked_change_order_id']),
    expectedBillAfter: strOrNull(row['expected_bill_after']),
    sourceReference: row['source_reference'] ?? '',
  }));
}

export function loadBillingItems(): BillingItem[] {
  return readCsv('billing.csv').map((row, i) => ({
    ...makeProv(i + 1, row),
    billingId: row['billing_id'] ?? '',
    billingPeriod: row['billing_period'] ?? '',
    invoiceNumber: row['invoice_number'] ?? '',
    lineId: String(row['line_id'] ?? ''),  // Always string
    description: row['description'] ?? '',
    costCode: row['cost_code'] ?? '',
    changeOrderId: strOrNull(row['change_order_id']),
    changeOrderLineNumber: row['change_order_line_number']
      ? parseInt(row['change_order_line_number'], 10)
      : null,
    amount: num(row['amount']),
    quantity: numOrNull(row['quantity']),
    unitPrice: numOrNull(row['unit_price']),
    unit: strOrNull(row['unit']),
    retainage: numOrNull(row['retainage']),
    billedToDate: numOrNull(row['billed_to_date']),
    billingDate: strOrNull(row['billing_date']),
    sourceReference: row['source_reference'] ?? '',
  }));
}

export function loadRateTable(): RateTableEntry[] {
  return readCsv('rate_table.csv').map((row, i) => ({
    ...makeProv(i + 1, row),
    rateId: row['rate_id'] ?? '',
    rateType: (row['rate_type'] ?? 'unknown') as RateType,
    rateBasis: (row['rate_basis'] ?? 'lump_sum') as RateBasis,
    amount: num(row['amount']),
    effectiveFrom: row['effective_from'] ?? '',
    effectiveTo: strOrNull(row['effective_to']),
    description: row['description'] ?? '',
  }));
}

export function loadEvidence(): { records: EvidenceRecord[]; links: EvidenceLink[] } {
  const rows = readCsv('evidence.csv');
  const records: EvidenceRecord[] = [];
  const links: EvidenceLink[] = [];

  rows.forEach((row, i) => {
    const evidenceId = row['evidence_id'] ?? '';
    const record: EvidenceRecord = {
      ...makeProv(i + 1, row),
      evidenceId,
      date: strOrNull(row['date']),
      type: (row['type'] ?? 'other') as EvidenceType,
      description: row['description'] ?? '',
      fileReference: row['file_reference'] ?? '',
      pageReference: String(row['page_reference'] ?? ''), // Always string
      timestamp: null,
      confidence: (row['confidence']?.toUpperCase() ?? 'MEDIUM') as ConfidenceLevel,
    };
    records.push(record);

    // Generate links from related_* columns
    if (row['related_change_order_id']) {
      links.push({
        evidenceId,
        entityType: 'change_order',
        entityId: row['related_change_order_id'],
        relationship: record.type === 'approval' ? 'approves' : 'supports',
        confidence: record.confidence,
      });
    }
    if (row['related_ticket_id']) {
      links.push({
        evidenceId,
        entityType: 'tm_ticket',
        entityId: row['related_ticket_id'],
        relationship: record.type === 'ticket' ? 'supports' : 'references',
        confidence: record.confidence,
      });
    }
    if (row['related_billing_id']) {
      links.push({
        evidenceId,
        entityType: 'billing_item',
        entityId: row['related_billing_id'],
        relationship: 'supports',
        confidence: record.confidence,
      });
    }
  });

  return { records, links };
}

/**
 * Build a complete AuditSnapshot from sample CSV fixtures.
 * Used by oracle tests and per-rule unit tests.
 */
export function buildSampleSnapshot(
  asOfDate = '2025-08-15',
  settingsOverride?: Partial<WorkspaceSettings>,
): AuditSnapshot {
  const evidence = loadEvidence();

  const settings: WorkspaceSettings = {
    workspaceId: WORKSPACE_ID,
    ...DEFAULT_SETTINGS,
    ...settingsOverride,
  };

  return {
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    asOfDate,
    settings,
    contractSovLines: loadContractSOV(),
    changeOrders: loadChangeOrders(),
    changeOrderLines: loadChangeOrderLines(),
    tmTickets: loadTMTickets(),
    billingItems: loadBillingItems(),
    rateTables: loadRateTable(),
    evidenceRecords: evidence.records,
    evidenceLinks: evidence.links,
    matches: [] as Match[], // v1.0: matches populated via matching service; fixture uses empty
  };
}
