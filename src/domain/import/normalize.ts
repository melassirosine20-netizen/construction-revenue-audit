/**
 * Normalization — mapped raw rows → domain entities with provenance
 * Spec: docs/02-data-model.md · docs/06-import-workflow.md · Phase 3
 *
 * Does not invent financial values. Invalid money/numbers fail the row (or field)
 * rather than becoming zero. Raw records remain untouched by this module.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  DocumentType,
  ChangeOrder,
  ChangeOrderLine,
  ContractSOVLine,
  BillingItem,
  TMTicket,
  RateTableEntry,
  EvidenceRecord,
  EvidenceLink,
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
import {
  coerceMoney,
  coerceNumber,
  coerceInteger,
  coerceString,
  coerceDate,
  coerceBoolean,
  coerceEnum,
} from './coerce.js';
import { invertMapping, type ColumnMapping } from './mapColumns.js';
import {
  getFieldsForEntity,
  type FieldDef,
  type MappingEntityKind,
} from './fieldCatalog.js';

export interface DataQualityWarning {
  code: string;
  message: string;
  sourceRow: number;
  field?: string;
  severity: 'error' | 'warning';
}

export interface NormalizeContext {
  workspaceId: string;
  projectId: string;
  sourceDocumentId: string;
  sourceImportId: string;
  documentType: DocumentType;
  entityKind: MappingEntityKind;
  mapping: ColumnMapping;
}

export interface NormalizeRowInput {
  sourceRow: number;
  rawPayload: Record<string, string>;
}

export type NormalizedEntity =
  | { kind: 'change_order'; entity: ChangeOrder }
  | { kind: 'change_order_line'; entity: ChangeOrderLine }
  | { kind: 'contract_sov'; entity: ContractSOVLine }
  | { kind: 'billing'; entity: BillingItem }
  | { kind: 'tm_ticket'; entity: TMTicket }
  | { kind: 'rate_table'; entity: RateTableEntry }
  | { kind: 'evidence'; entity: EvidenceRecord; links: EvidenceLink[] };

export interface NormalizeResult {
  entities: NormalizedEntity[];
  warnings: DataQualityWarning[];
  errorCount: number;
  successCount: number;
}

function pickMapped(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
): string {
  const source = inv[field];
  if (!source) return '';
  return raw[source] ?? '';
}

function moneyReq(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): number | null {
  const r = coerceMoney(pickMapped(raw, inv, field), { required: true, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_MONEY', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value as number;
}

function moneyOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): number | null {
  const r = coerceMoney(pickMapped(raw, inv, field), { required: false, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_MONEY', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value;
}

function numReq(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): number | null {
  const r = coerceNumber(pickMapped(raw, inv, field), { required: true, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_NUMBER', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value as number;
}

function numOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): number | null {
  const r = coerceNumber(pickMapped(raw, inv, field), { required: false, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_NUMBER', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value;
}

function intReq(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): number | null {
  const r = coerceInteger(pickMapped(raw, inv, field), { required: true, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_INTEGER', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value as number;
}

function intOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): number | null {
  const r = coerceInteger(pickMapped(raw, inv, field), { required: false, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_INTEGER', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value;
}

function strReq(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): string | null {
  const r = coerceString(pickMapped(raw, inv, field), { required: true, field });
  if (!r.ok) {
    warnings.push({ code: 'MISSING_STRING', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value as string;
}

function strOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
): string {
  const r = coerceString(pickMapped(raw, inv, field), { required: false, field });
  return r.ok && r.value != null ? r.value : '';
}

function strOptNull(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
): string | null {
  const r = coerceString(pickMapped(raw, inv, field), { required: false, field });
  return r.ok ? r.value : null;
}

function dateReq(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): string | null {
  const r = coerceDate(pickMapped(raw, inv, field), { required: true, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_DATE', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value as string;
}

function dateOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): string | null {
  const r = coerceDate(pickMapped(raw, inv, field), { required: false, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_DATE', message: r.message, sourceRow, field, severity: 'warning' });
    return null;
  }
  return r.value;
}

function enumReq(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  values: string[],
  warnings: DataQualityWarning[],
  sourceRow: number,
): string | null {
  const r = coerceEnum(pickMapped(raw, inv, field), { required: true, field, values });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_ENUM', message: r.message, sourceRow, field, severity: 'error' });
    return null;
  }
  return r.value as string;
}

function enumOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  values: string[],
  fallback: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): string {
  const r = coerceEnum(pickMapped(raw, inv, field), { required: false, field, values });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_ENUM', message: r.message, sourceRow, field, severity: 'warning' });
    return fallback;
  }
  return r.value ?? fallback;
}

function boolOpt(
  raw: Record<string, string>,
  inv: Record<string, string>,
  field: string,
  warnings: DataQualityWarning[],
  sourceRow: number,
): boolean {
  const r = coerceBoolean(pickMapped(raw, inv, field), { required: false, field });
  if (!r.ok) {
    warnings.push({ code: 'INVALID_BOOLEAN', message: r.message, sourceRow, field, severity: 'warning' });
    return false;
  }
  return r.value ?? false;
}

function provenance(
  ctx: NormalizeContext,
  sourceRow: number,
  rawPayload: Record<string, string>,
) {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    sourceDocumentId: ctx.sourceDocumentId,
    sourceImportId: ctx.sourceImportId,
    sourceRowOrPage: String(sourceRow),
    rawValues: { ...rawPayload },
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeChangeOrder(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): ChangeOrder | null {
  const { rawPayload: raw, sourceRow } = row;
  const changeOrderId = strReq(raw, inv, 'change_order_id', warnings, sourceRow);
  const status = enumReq(
    raw, inv, 'status',
    ['submitted', 'approved', 'rejected', 'cancelled', 'void'],
    warnings, sourceRow,
  );
  const approvedAmount = moneyReq(raw, inv, 'approved_amount', warnings, sourceRow);
  if (changeOrderId == null || status == null || approvedAmount == null) return null;

  const original = moneyOpt(raw, inv, 'original_amount', warnings, sourceRow);
  // If original was present but invalid, moneyOpt already pushed error — fail row
  if (pickMapped(raw, inv, 'original_amount') && original == null) {
    const hasErr = warnings.some(
      (w) => w.sourceRow === sourceRow && w.field === 'original_amount' && w.severity === 'error',
    );
    if (hasErr) return null;
  }

  return {
    ...provenance(ctx, sourceRow, raw),
    changeOrderId,
    title: strOpt(raw, inv, 'title'),
    description: strOpt(raw, inv, 'description'),
    status: status as ChangeOrderStatus,
    changeMethod: enumOpt(
      raw, inv, 'change_method',
      ['fixed_price', 't_and_m', 'unit_price', 'allowance', 'unknown'],
      'unknown', warnings, sourceRow,
    ) as ChangeMethod,
    submittedDate: dateOpt(raw, inv, 'submitted_date', warnings, sourceRow),
    approvedDate: dateOpt(raw, inv, 'approved_date', warnings, sourceRow),
    effectiveDate: dateOpt(raw, inv, 'effective_date', warnings, sourceRow),
    originalAmount: original ?? 0,
    approvedAmount,
    customerReference: strOpt(raw, inv, 'customer_reference'),
    costCode: strOpt(raw, inv, 'cost_code'),
    expectedBillAfter: dateOpt(raw, inv, 'expected_bill_after', warnings, sourceRow),
    sourceReference: strOpt(raw, inv, 'source_reference'),
  };
}

function normalizeChangeOrderLine(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): ChangeOrderLine | null {
  const { rawPayload: raw, sourceRow } = row;
  const changeOrderId = strReq(raw, inv, 'change_order_id', warnings, sourceRow);
  const lineNumber = intReq(raw, inv, 'line_number', warnings, sourceRow);
  const quantity = numReq(raw, inv, 'quantity', warnings, sourceRow);
  const unit = strReq(raw, inv, 'unit', warnings, sourceRow);
  const approvedUnitPrice = moneyReq(raw, inv, 'approved_unit_price', warnings, sourceRow);
  const approvedAmount = moneyReq(raw, inv, 'approved_amount', warnings, sourceRow);
  if (
    changeOrderId == null ||
    lineNumber == null ||
    quantity == null ||
    unit == null ||
    approvedUnitPrice == null ||
    approvedAmount == null
  ) {
    return null;
  }
  return {
    ...provenance(ctx, sourceRow, raw),
    changeOrderId,
    lineNumber,
    description: strOpt(raw, inv, 'description'),
    costCode: strOptNull(raw, inv, 'cost_code'),
    quantity,
    unit,
    approvedUnitPrice,
    approvedAmount,
    rateType: enumOpt(
      raw, inv, 'rate_type',
      ['labor_bill', 'overtime_bill', 'material_markup', 'equipment_bill', 'unit_sell', 'lump_sum', 'unknown'],
      'unknown', warnings, sourceRow,
    ) as RateType,
    rateBasis: enumOpt(
      raw, inv, 'rate_basis',
      ['hourly', 'percentage', 'unit', 'lump_sum'],
      'unit', warnings, sourceRow,
    ) as RateBasis,
  };
}

function normalizeContractSov(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): ContractSOVLine | null {
  const { rawPayload: raw, sourceRow } = row;
  const contractId = strReq(raw, inv, 'contract_id', warnings, sourceRow);
  const lineId = strReq(raw, inv, 'line_id', warnings, sourceRow);
  const description = strReq(raw, inv, 'description', warnings, sourceRow);
  const originalAmount = moneyReq(raw, inv, 'original_amount', warnings, sourceRow);
  if (contractId == null || lineId == null || description == null || originalAmount == null) {
    return null;
  }
  const revised = moneyOpt(raw, inv, 'approved_revised_amount', warnings, sourceRow);
  if (pickMapped(raw, inv, 'approved_revised_amount') && revised == null) {
    const hasErr = warnings.some(
      (w) => w.sourceRow === sourceRow && w.field === 'approved_revised_amount' && w.severity === 'error',
    );
    if (hasErr) return null;
  }
  return {
    ...provenance(ctx, sourceRow, raw),
    contractId,
    lineId: String(lineId),
    costCode: strOpt(raw, inv, 'cost_code'),
    description,
    originalAmount,
    approvedRevisedAmount: revised ?? originalAmount,
    quantity: numOpt(raw, inv, 'quantity', warnings, sourceRow),
    unit: strOptNull(raw, inv, 'unit'),
    unitPrice: moneyOpt(raw, inv, 'unit_price', warnings, sourceRow),
    retainage: moneyOpt(raw, inv, 'retainage', warnings, sourceRow),
    sourceReference: strOpt(raw, inv, 'source_reference'),
  };
}

function normalizeBilling(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): BillingItem | null {
  const { rawPayload: raw, sourceRow } = row;
  const billingId = strReq(raw, inv, 'billing_id', warnings, sourceRow);
  const lineId = strReq(raw, inv, 'line_id', warnings, sourceRow);
  const amount = moneyReq(raw, inv, 'amount', warnings, sourceRow);
  if (billingId == null || lineId == null || amount == null) return null;

  return {
    ...provenance(ctx, sourceRow, raw),
    billingId,
    billingPeriod: strOpt(raw, inv, 'billing_period'),
    invoiceNumber: strOpt(raw, inv, 'invoice_number'),
    lineId: String(lineId),
    description: strOpt(raw, inv, 'description'),
    costCode: strOpt(raw, inv, 'cost_code'),
    changeOrderId: strOptNull(raw, inv, 'change_order_id'),
    changeOrderLineNumber: intOpt(raw, inv, 'change_order_line_number', warnings, sourceRow),
    amount,
    quantity: numOpt(raw, inv, 'quantity', warnings, sourceRow),
    unitPrice: moneyOpt(raw, inv, 'unit_price', warnings, sourceRow),
    unit: strOptNull(raw, inv, 'unit'),
    retainage: moneyOpt(raw, inv, 'retainage', warnings, sourceRow),
    billedToDate: moneyOpt(raw, inv, 'billed_to_date', warnings, sourceRow),
    billingDate: dateOpt(raw, inv, 'billing_date', warnings, sourceRow),
    sourceReference: strOpt(raw, inv, 'source_reference'),
  };
}

function normalizeTmTicket(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): TMTicket | null {
  const { rawPayload: raw, sourceRow } = row;
  const ticketId = strReq(raw, inv, 'ticket_id', warnings, sourceRow);
  const date = dateReq(raw, inv, 'date', warnings, sourceRow);
  const totalAmount = moneyReq(raw, inv, 'total_amount', warnings, sourceRow);
  if (ticketId == null || date == null || totalAmount == null) return null;

  return {
    ...provenance(ctx, sourceRow, raw),
    ticketId,
    date,
    description: strOpt(raw, inv, 'description'),
    workerOrCategory: strOpt(raw, inv, 'worker_or_category'),
    laborHours: numOpt(raw, inv, 'labor_hours', warnings, sourceRow) ?? 0,
    laborRate: moneyOpt(raw, inv, 'labor_rate', warnings, sourceRow) ?? 0,
    laborRateType: enumOpt(
      raw, inv, 'labor_rate_type',
      ['labor_cost', 'labor_bill', 'overtime_bill', 'unknown'],
      'unknown', warnings, sourceRow,
    ) as LaborRateType,
    laborAmount: moneyOpt(raw, inv, 'labor_amount', warnings, sourceRow) ?? 0,
    materialAmount: moneyOpt(raw, inv, 'material_amount', warnings, sourceRow) ?? 0,
    equipmentAmount: moneyOpt(raw, inv, 'equipment_amount', warnings, sourceRow) ?? 0,
    totalAmount,
    approvalStatus: enumOpt(
      raw, inv, 'approval_status',
      ['pending', 'approved', 'rejected'],
      'pending', warnings, sourceRow,
    ) as ApprovalStatus,
    customerSignature: boolOpt(raw, inv, 'customer_signature', warnings, sourceRow),
    billableStatus: enumOpt(
      raw, inv, 'billable_status',
      ['billable', 'non_billable', 'unknown'],
      'unknown', warnings, sourceRow,
    ) as BillableStatus,
    billingExpected: enumOpt(
      raw, inv, 'billing_expected',
      ['true', 'false', 'unknown'],
      'unknown', warnings, sourceRow,
    ) as BillingExpected,
    billingBasis: enumOpt(
      raw, inv, 'billing_basis',
      ['change_order', 'contract', 't_and_m', 'unknown'],
      'unknown', warnings, sourceRow,
    ) as BillingBasis,
    linkedChangeOrderId: strOptNull(raw, inv, 'linked_change_order_id'),
    expectedBillAfter: dateOpt(raw, inv, 'expected_bill_after', warnings, sourceRow),
    sourceReference: strOpt(raw, inv, 'source_reference'),
  };
}

function normalizeRateTable(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): RateTableEntry | null {
  const { rawPayload: raw, sourceRow } = row;
  const rateId = strReq(raw, inv, 'rate_id', warnings, sourceRow);
  const rateType = enumReq(
    raw, inv, 'rate_type',
    ['labor_bill', 'overtime_bill', 'material_markup', 'equipment_bill', 'unit_sell', 'lump_sum', 'unknown'],
    warnings, sourceRow,
  );
  const rateBasis = enumReq(
    raw, inv, 'rate_basis',
    ['hourly', 'percentage', 'unit', 'lump_sum'],
    warnings, sourceRow,
  );
  const amount = moneyReq(raw, inv, 'amount', warnings, sourceRow);
  const effectiveFrom = dateReq(raw, inv, 'effective_from', warnings, sourceRow);
  if (rateId == null || rateType == null || rateBasis == null || amount == null || effectiveFrom == null) {
    return null;
  }
  return {
    ...provenance(ctx, sourceRow, raw),
    rateId,
    rateType: rateType as RateType,
    rateBasis: rateBasis as RateBasis,
    amount,
    effectiveFrom,
    effectiveTo: dateOpt(raw, inv, 'effective_to', warnings, sourceRow),
    description: strOpt(raw, inv, 'description'),
  };
}

function normalizeEvidence(
  ctx: NormalizeContext,
  inv: Record<string, string>,
  row: NormalizeRowInput,
  warnings: DataQualityWarning[],
): { entity: EvidenceRecord; links: EvidenceLink[] } | null {
  const { rawPayload: raw, sourceRow } = row;
  const evidenceId = strReq(raw, inv, 'evidence_id', warnings, sourceRow);
  if (evidenceId == null) return null;

  const confRaw = enumOpt(
    raw, inv, 'confidence',
    ['HIGH', 'MEDIUM', 'LOW', 'high', 'medium', 'low'],
    'MEDIUM', warnings, sourceRow,
  );
  const confidence = confRaw.toUpperCase() as ConfidenceLevel;

  const entity: EvidenceRecord = {
    ...provenance(ctx, sourceRow, raw),
    evidenceId,
    date: dateOpt(raw, inv, 'date', warnings, sourceRow),
    type: enumOpt(
      raw, inv, 'type',
      ['ticket', 'approval', 'photo', 'email', 'signature', 'daily_report', 'other'],
      'other', warnings, sourceRow,
    ) as EvidenceType,
    description: strOpt(raw, inv, 'description'),
    fileReference: strOpt(raw, inv, 'file_reference'),
    pageReference: strOpt(raw, inv, 'page_reference') || '',
    timestamp: null,
    confidence,
  };

  const links: EvidenceLink[] = [];
  const ticket = strOptNull(raw, inv, 'related_ticket_id');
  if (ticket) {
    links.push({
      evidenceId,
      entityType: 'tm_ticket',
      entityId: ticket,
      relationship: 'supports',
      confidence,
    });
  }
  const co = strOptNull(raw, inv, 'related_change_order_id');
  if (co) {
    links.push({
      evidenceId,
      entityType: 'change_order',
      entityId: co,
      relationship: 'supports',
      confidence,
    });
  }
  const bill = strOptNull(raw, inv, 'related_billing_id');
  if (bill) {
    links.push({
      evidenceId,
      entityType: 'billing_item',
      entityId: bill,
      relationship: 'supports',
      confidence,
    });
  }

  return { entity, links };
}

/**
 * Normalize a batch of raw rows using a confirmed column mapping.
 */
export function normalizeRows(
  ctx: NormalizeContext,
  rows: NormalizeRowInput[],
): NormalizeResult {
  const inv = invertMapping(ctx.mapping);
  const warnings: DataQualityWarning[] = [];
  const entities: NormalizedEntity[] = [];
  let errorCount = 0;
  let successCount = 0;

  for (const row of rows) {
    const before = warnings.length;
    let entity: NormalizedEntity | null = null;

    switch (ctx.entityKind) {
      case 'change_order': {
        const e = normalizeChangeOrder(ctx, inv, row, warnings);
        if (e) entity = { kind: 'change_order', entity: e };
        break;
      }
      case 'change_order_line': {
        const e = normalizeChangeOrderLine(ctx, inv, row, warnings);
        if (e) entity = { kind: 'change_order_line', entity: e };
        break;
      }
      case 'contract_sov': {
        const e = normalizeContractSov(ctx, inv, row, warnings);
        if (e) entity = { kind: 'contract_sov', entity: e };
        break;
      }
      case 'billing': {
        const e = normalizeBilling(ctx, inv, row, warnings);
        if (e) entity = { kind: 'billing', entity: e };
        break;
      }
      case 'tm_ticket': {
        const e = normalizeTmTicket(ctx, inv, row, warnings);
        if (e) entity = { kind: 'tm_ticket', entity: e };
        break;
      }
      case 'rate_table': {
        const e = normalizeRateTable(ctx, inv, row, warnings);
        if (e) entity = { kind: 'rate_table', entity: e };
        break;
      }
      case 'evidence': {
        const e = normalizeEvidence(ctx, inv, row, warnings);
        if (e) entity = { kind: 'evidence', entity: e.entity, links: e.links };
        break;
      }
    }

    const rowErrors = warnings.slice(before).filter((w) => w.severity === 'error');
    if (entity && rowErrors.length === 0) {
      entities.push(entity);
      successCount++;
    } else {
      errorCount++;
      if (!entity && rowErrors.length === 0) {
        warnings.push({
          code: 'ROW_FAILED',
          message: `Row ${row.sourceRow}: failed to normalize`,
          sourceRow: row.sourceRow,
          severity: 'error',
        });
      }
    }
  }

  return { entities, warnings, errorCount, successCount };
}

/** Resolve entity kind from document type + optional override. */
export function resolveEntityKind(
  documentType: DocumentType,
  entityKind?: MappingEntityKind,
): MappingEntityKind | null {
  if (entityKind) return entityKind;
  switch (documentType) {
    case 'change_order':
      return 'change_order';
    case 'contract_sov':
      return 'contract_sov';
    case 'billing':
      return 'billing';
    case 'tm_ticket':
      return 'tm_ticket';
    case 'evidence':
      return 'evidence';
    default:
      return null;
  }
}

export function catalogFields(entityKind: MappingEntityKind): FieldDef[] {
  return getFieldsForEntity(entityKind);
}
