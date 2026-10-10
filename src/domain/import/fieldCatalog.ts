/**
 * Field catalog for column mapping — Phase 3
 * Spec: schemas/*.json · docs/02-data-model.md · docs/06-import-workflow.md
 *
 * Canonical target field names are snake_case to match CSV/schema conventions.
 * Domain entities use camelCase; normalize.ts maps between them.
 */
import type { DocumentType } from '../types.js';

export type FieldKind =
  | 'string'
  | 'number'
  | 'money'
  | 'date'
  | 'boolean'
  | 'integer'
  | 'enum';

export interface FieldDef {
  /** Canonical target field (snake_case, matches schema / CSV samples) */
  name: string;
  kind: FieldKind;
  required: boolean;
  /** Recognized header aliases (lowercase, normalized) */
  aliases: string[];
  /** Allowed enum values when kind === 'enum' */
  enumValues?: string[];
  /** Human label for errors */
  label: string;
}

export interface DocumentTypeCatalog {
  documentType: DocumentType;
  fields: FieldDef[];
}

function f(
  name: string,
  kind: FieldKind,
  required: boolean,
  aliases: string[],
  label: string,
  enumValues?: string[],
): FieldDef {
  return { name, kind, required, aliases: aliases.map((a) => a.toLowerCase()), label, enumValues };
}

export const CHANGE_ORDER_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project', 'proj_id'], 'Project ID'),
  f('change_order_id', 'string', true, ['change_order_id', 'co_id', 'co_number', 'change_order', 'co#'], 'Change Order ID'),
  f('title', 'string', false, ['title', 'name', 'subject'], 'Title'),
  f('description', 'string', false, ['description', 'desc', 'details'], 'Description'),
  f('status', 'enum', true, ['status', 'co_status', 'approval_status'], 'Status', [
    'submitted', 'approved', 'rejected', 'cancelled', 'void',
  ]),
  f('change_method', 'enum', false, ['change_method', 'method', 'pricing_method'], 'Change Method', [
    'fixed_price', 't_and_m', 'unit_price', 'allowance', 'unknown',
  ]),
  f('submitted_date', 'date', false, ['submitted_date', 'submit_date', 'date_submitted'], 'Submitted Date'),
  f('approved_date', 'date', false, ['approved_date', 'date_approved', 'approval_date'], 'Approved Date'),
  f('effective_date', 'date', false, ['effective_date', 'date_effective'], 'Effective Date'),
  f('original_amount', 'money', false, ['original_amount', 'original_value', 'requested_amount'], 'Original Amount'),
  f('approved_amount', 'money', true, ['approved_amount', 'approved_value', 'amount'], 'Approved Amount'),
  f('customer_reference', 'string', false, ['customer_reference', 'customer_ref', 'cor_number'], 'Customer Reference'),
  f('cost_code', 'string', false, ['cost_code', 'costcode', 'code'], 'Cost Code'),
  f('expected_bill_after', 'date', false, ['expected_bill_after', 'bill_after'], 'Expected Bill After'),
  f('source_reference', 'string', false, ['source_reference', 'source_ref', 'ref'], 'Source Reference'),
];

export const CHANGE_ORDER_LINE_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project'], 'Project ID'),
  f('change_order_id', 'string', true, ['change_order_id', 'co_id', 'change_order'], 'Change Order ID'),
  f('line_number', 'integer', true, ['line_number', 'line_no', 'line', 'line_id'], 'Line Number'),
  f('description', 'string', false, ['description', 'desc'], 'Description'),
  f('cost_code', 'string', false, ['cost_code', 'costcode'], 'Cost Code'),
  f('quantity', 'number', true, ['quantity', 'qty'], 'Quantity'),
  f('unit', 'string', true, ['unit', 'uom'], 'Unit'),
  f('approved_unit_price', 'money', true, ['approved_unit_price', 'unit_price', 'rate'], 'Approved Unit Price'),
  f('approved_amount', 'money', true, ['approved_amount', 'amount', 'line_amount'], 'Approved Amount'),
  f('rate_type', 'enum', false, ['rate_type'], 'Rate Type', [
    'labor_bill', 'overtime_bill', 'material_markup', 'equipment_bill', 'unit_sell', 'lump_sum', 'unknown',
  ]),
  f('rate_basis', 'enum', false, ['rate_basis'], 'Rate Basis', [
    'hourly', 'percentage', 'unit', 'lump_sum',
  ]),
];

export const CONTRACT_SOV_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project'], 'Project ID'),
  f('contract_id', 'string', true, ['contract_id', 'contract', 'contract_number'], 'Contract ID'),
  f('line_id', 'string', true, ['line_id', 'line', 'sov_line', 'line_number'], 'Line ID'),
  f('cost_code', 'string', false, ['cost_code', 'costcode'], 'Cost Code'),
  f('description', 'string', true, ['description', 'desc'], 'Description'),
  f('original_amount', 'money', true, ['original_amount', 'original_value', 'amount'], 'Original Amount'),
  f('approved_revised_amount', 'money', false, ['approved_revised_amount', 'revised_amount', 'current_amount'], 'Approved Revised Amount'),
  f('quantity', 'number', false, ['quantity', 'qty'], 'Quantity'),
  f('unit', 'string', false, ['unit', 'uom'], 'Unit'),
  f('unit_price', 'money', false, ['unit_price', 'rate'], 'Unit Price'),
  f('retainage', 'money', false, ['retainage', 'retention'], 'Retainage'),
  f('source_reference', 'string', false, ['source_reference', 'source_ref'], 'Source Reference'),
];

export const BILLING_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project'], 'Project ID'),
  f('billing_id', 'string', true, ['billing_id', 'invoice_id', 'pay_app_id'], 'Billing ID'),
  f('billing_period', 'string', false, ['billing_period', 'period'], 'Billing Period'),
  f('invoice_number', 'string', false, ['invoice_number', 'invoice_no', 'invoice'], 'Invoice Number'),
  f('line_id', 'string', true, ['line_id', 'line', 'line_number'], 'Line ID'),
  f('description', 'string', false, ['description', 'desc'], 'Description'),
  f('cost_code', 'string', false, ['cost_code', 'costcode'], 'Cost Code'),
  f('change_order_id', 'string', false, ['change_order_id', 'co_id', 'change_order'], 'Change Order ID'),
  f('change_order_line_number', 'integer', false, ['change_order_line_number', 'co_line'], 'CO Line Number'),
  f('amount', 'money', true, ['amount', 'billed_amount', 'line_amount'], 'Amount'),
  f('quantity', 'number', false, ['quantity', 'qty'], 'Quantity'),
  f('unit_price', 'money', false, ['unit_price', 'rate'], 'Unit Price'),
  f('unit', 'string', false, ['unit', 'uom'], 'Unit'),
  f('retainage', 'money', false, ['retainage', 'retention'], 'Retainage'),
  f('billed_to_date', 'money', false, ['billed_to_date', 'to_date'], 'Billed To Date'),
  f('billing_date', 'date', false, ['billing_date', 'invoice_date', 'date'], 'Billing Date'),
  f('source_reference', 'string', false, ['source_reference', 'source_ref'], 'Source Reference'),
];

export const TM_TICKET_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project'], 'Project ID'),
  f('ticket_id', 'string', true, ['ticket_id', 'tm_id', 'ticket_number', 'ticket'], 'Ticket ID'),
  f('date', 'date', true, ['date', 'ticket_date', 'work_date'], 'Date'),
  f('description', 'string', false, ['description', 'desc'], 'Description'),
  f('worker_or_category', 'string', false, ['worker_or_category', 'worker', 'category', 'trade'], 'Worker/Category'),
  f('labor_hours', 'number', false, ['labor_hours', 'hours'], 'Labor Hours'),
  f('labor_rate', 'money', false, ['labor_rate', 'hourly_rate'], 'Labor Rate'),
  f('labor_rate_type', 'enum', false, ['labor_rate_type', 'rate_type'], 'Labor Rate Type', [
    'labor_cost', 'labor_bill', 'overtime_bill', 'unknown',
  ]),
  f('labor_amount', 'money', false, ['labor_amount'], 'Labor Amount'),
  f('material_amount', 'money', false, ['material_amount', 'materials'], 'Material Amount'),
  f('equipment_amount', 'money', false, ['equipment_amount', 'equipment'], 'Equipment Amount'),
  f('total_amount', 'money', true, ['total_amount', 'total', 'amount'], 'Total Amount'),
  f('approval_status', 'enum', false, ['approval_status', 'status'], 'Approval Status', [
    'pending', 'approved', 'rejected',
  ]),
  f('customer_signature', 'boolean', false, ['customer_signature', 'signed', 'signature'], 'Customer Signature'),
  f('billable_status', 'enum', false, ['billable_status', 'billable'], 'Billable Status', [
    'billable', 'non_billable', 'unknown',
  ]),
  f('billing_expected', 'enum', false, ['billing_expected'], 'Billing Expected', [
    'true', 'false', 'unknown',
  ]),
  f('billing_basis', 'enum', false, ['billing_basis'], 'Billing Basis', [
    'change_order', 'contract', 't_and_m', 'unknown',
  ]),
  f('linked_change_order_id', 'string', false, ['linked_change_order_id', 'change_order_id', 'co_id'], 'Linked CO ID'),
  f('expected_bill_after', 'date', false, ['expected_bill_after'], 'Expected Bill After'),
  f('source_reference', 'string', false, ['source_reference', 'source_ref'], 'Source Reference'),
];

export const RATE_TABLE_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project'], 'Project ID'),
  f('rate_id', 'string', true, ['rate_id', 'id'], 'Rate ID'),
  f('rate_type', 'enum', true, ['rate_type', 'type'], 'Rate Type', [
    'labor_bill', 'overtime_bill', 'material_markup', 'equipment_bill', 'unit_sell', 'lump_sum', 'unknown',
  ]),
  f('rate_basis', 'enum', true, ['rate_basis', 'basis'], 'Rate Basis', [
    'hourly', 'percentage', 'unit', 'lump_sum',
  ]),
  f('amount', 'money', true, ['amount', 'rate', 'value'], 'Amount'),
  f('effective_from', 'date', true, ['effective_from', 'from', 'start_date'], 'Effective From'),
  f('effective_to', 'date', false, ['effective_to', 'to', 'end_date'], 'Effective To'),
  f('description', 'string', false, ['description', 'desc'], 'Description'),
];

export const EVIDENCE_FIELDS: FieldDef[] = [
  f('project_id', 'string', false, ['project_id', 'project'], 'Project ID'),
  f('evidence_id', 'string', true, ['evidence_id', 'id'], 'Evidence ID'),
  f('date', 'date', false, ['date', 'evidence_date'], 'Date'),
  f('type', 'enum', false, ['type', 'evidence_type'], 'Type', [
    'ticket', 'approval', 'photo', 'email', 'signature', 'daily_report', 'other',
  ]),
  f('description', 'string', false, ['description', 'desc'], 'Description'),
  f('related_ticket_id', 'string', false, ['related_ticket_id', 'ticket_id'], 'Related Ticket'),
  f('related_change_order_id', 'string', false, ['related_change_order_id', 'change_order_id', 'co_id'], 'Related CO'),
  f('related_billing_id', 'string', false, ['related_billing_id', 'billing_id'], 'Related Billing'),
  f('file_reference', 'string', false, ['file_reference', 'file', 'filename'], 'File Reference'),
  f('page_reference', 'string', false, ['page_reference', 'page'], 'Page Reference'),
  f('confidence', 'enum', false, ['confidence'], 'Confidence', ['HIGH', 'MEDIUM', 'LOW', 'high', 'medium', 'low']),
];

const CATALOG: Record<string, FieldDef[]> = {
  change_order: CHANGE_ORDER_FIELDS,
  // change_order_lines share document_type change_order in upload; use explicit type key
  change_order_line: CHANGE_ORDER_LINE_FIELDS,
  contract_sov: CONTRACT_SOV_FIELDS,
  billing: BILLING_FIELDS,
  tm_ticket: TM_TICKET_FIELDS,
  evidence: EVIDENCE_FIELDS,
  rate_table: RATE_TABLE_FIELDS,
  unknown: [],
};

/** Mapping target entity kind used when document_type alone is ambiguous */
export type MappingEntityKind =
  | 'change_order'
  | 'change_order_line'
  | 'contract_sov'
  | 'billing'
  | 'tm_ticket'
  | 'evidence'
  | 'rate_table';

export function getFieldsForEntity(kind: MappingEntityKind): FieldDef[] {
  return CATALOG[kind] ?? [];
}

export function getFieldsForDocumentType(
  documentType: DocumentType,
  entityKind?: MappingEntityKind,
): FieldDef[] {
  if (entityKind) return getFieldsForEntity(entityKind);
  if (documentType === 'change_order') return CHANGE_ORDER_FIELDS;
  if (documentType === 'contract_sov') return CONTRACT_SOV_FIELDS;
  if (documentType === 'billing') return BILLING_FIELDS;
  if (documentType === 'tm_ticket') return TM_TICKET_FIELDS;
  if (documentType === 'evidence') return EVIDENCE_FIELDS;
  return [];
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s\-]+/g, '_');
}
