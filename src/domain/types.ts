/**
 * Core domain types for Construction Revenue Audit
 * Spec version: 1.0.0 — FROZEN
 * Do NOT add fields not in docs/02-data-model.md
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type ProjectStatus = 'active' | 'archived';

export type DocumentType =
  | 'contract_sov'
  | 'change_order'
  | 'tm_ticket'
  | 'billing'
  | 'evidence'
  | 'unknown';

export type ImportStatus =
  | 'pending'
  | 'parsing'
  | 'mapping'
  | 'validating'
  | 'imported'
  | 'failed';

export type ChangeOrderStatus =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'void';

export type ChangeMethod =
  | 'fixed_price'
  | 't_and_m'
  | 'unit_price'
  | 'allowance'
  | 'unknown';

export type RateType =
  | 'labor_bill'
  | 'overtime_bill'
  | 'material_markup'
  | 'equipment_bill'
  | 'unit_sell'
  | 'lump_sum'
  | 'unknown';

export type RateBasis = 'hourly' | 'percentage' | 'unit' | 'lump_sum';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type LaborRateType = 'labor_cost' | 'labor_bill' | 'overtime_bill' | 'unknown';

export type BillableStatus = 'billable' | 'non_billable' | 'unknown';

/** billing_expected is stored as a string enum (per spec: "store as text/enum") */
export type BillingExpected = 'true' | 'false' | 'unknown';

export type BillingBasis = 'change_order' | 'contract' | 't_and_m' | 'unknown';

export type MatchMethod =
  | 'exact_id'
  | 'strong_composite'
  | 'structured_attributes'
  | 'fuzzy_semantic'
  | 'user_confirmed';

export type EvidenceType =
  | 'ticket'
  | 'approval'
  | 'photo'
  | 'email'
  | 'signature'
  | 'daily_report'
  | 'other';

export type EvidenceEntityType =
  | 'tm_ticket'
  | 'change_order'
  | 'billing_item'
  | 'contract_sov';

export type EvidenceRelationship = 'supports' | 'approves' | 'references' | 'attached_to';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type AuditRunStatus = 'running' | 'completed' | 'failed';

export type FindingType =
  | 'REVENUE_AT_RISK'
  | 'REVENUE_RECONCILIATION'
  | 'BILLING_MISMATCH'
  | 'RATE_MISMATCH'
  | 'QUANTITY_MISMATCH'
  | 'DUPLICATE'
  | 'EVIDENCE_RISK'
  | 'MISSING_LINK'
  | 'DATA_QUALITY';

export type FinancialDirection =
  | 'UNDERBILLED'
  | 'OVERBILLED'
  | 'EVIDENCE_RISK'
  | 'DATA_QUALITY'
  | 'NONE';

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type FindingStatus = 'OPEN' | 'REVIEWED' | 'ACCEPTED' | 'DISMISSED' | 'RESOLVED';

export type FindingEventType =
  | 'created'
  | 'reviewed'
  | 'accepted'
  | 'dismissed'
  | 'resolved'
  | 'recalculated'
  | 'commented';

// ─── Common provenance ─────────────────────────────────────────────────────────

export interface Provenance {
  id: string;
  projectId: string;
  workspaceId: string;
  sourceDocumentId: string;
  sourceImportId: string;
  sourceRowOrPage: string;
  rawValues: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Normalized entities ───────────────────────────────────────────────────────

export interface ContractSOVLine extends Provenance {
  contractId: string;
  lineId: string; // Always string
  costCode: string;
  description: string;
  originalAmount: number;
  approvedRevisedAmount: number;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  retainage: number | null;
  sourceReference: string;
}

export interface ChangeOrder extends Provenance {
  changeOrderId: string; // business key e.g. CO-014
  title: string;
  description: string;
  status: ChangeOrderStatus;
  changeMethod: ChangeMethod;
  submittedDate: string | null;
  approvedDate: string | null;
  effectiveDate: string | null;
  originalAmount: number;
  approvedAmount: number;
  customerReference: string;
  costCode: string;
  expectedBillAfter: string | null;
  sourceReference: string;
}

export interface ChangeOrderLine extends Provenance {
  changeOrderId: string;
  lineNumber: number;
  description: string;
  costCode: string | null;
  quantity: number;
  unit: string;
  approvedUnitPrice: number;
  approvedAmount: number;
  rateType: RateType;
  rateBasis: RateBasis;
}

export interface TMTicket extends Provenance {
  ticketId: string; // business key e.g. TM-042
  date: string;
  description: string;
  workerOrCategory: string;
  laborHours: number;
  laborRate: number;
  laborRateType: LaborRateType;
  laborAmount: number;
  materialAmount: number;
  equipmentAmount: number;
  totalAmount: number;
  approvalStatus: ApprovalStatus;
  customerSignature: boolean;
  billableStatus: BillableStatus;
  billingExpected: BillingExpected;
  billingBasis: BillingBasis;
  linkedChangeOrderId: string | null;
  expectedBillAfter: string | null;
  sourceReference: string;
}

export interface BillingItem extends Provenance {
  billingId: string; // invoice/pay-app business key
  billingPeriod: string;
  invoiceNumber: string;
  lineId: string; // Always string
  description: string;
  costCode: string;
  changeOrderId: string | null;
  changeOrderLineNumber: number | null;
  amount: number;
  quantity: number | null;
  unitPrice: number | null;
  unit: string | null;
  retainage: number | null;
  billedToDate: number | null;
  billingDate: string | null;
  sourceReference: string;
}

export interface RateTableEntry extends Provenance {
  rateId: string;
  rateType: RateType;
  rateBasis: RateBasis;
  amount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  description: string;
}

export interface EvidenceRecord extends Provenance {
  evidenceId: string;
  date: string | null;
  type: EvidenceType;
  description: string;
  fileReference: string;
  pageReference: string; // Always string per spec
  timestamp: string | null;
  confidence: ConfidenceLevel;
}

export interface EvidenceLink {
  evidenceId: string;
  entityType: EvidenceEntityType;
  entityId: string;
  relationship: EvidenceRelationship;
  confidence: ConfidenceLevel;
}

export interface Match {
  matchId: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  matchMethod: MatchMethod;
  matchConfidence: number;
  userConfirmed: boolean;
  createdAt: string;
}

// ─── Audit engine types ─────────────────────────────────────────────────────────

export interface WorkspaceSettings {
  workspaceId: string;
  materialityAbsolute: number; // default 100
  materialityPct: number;      // default 0.005
  roundingCurrency: number;    // default 0.01
  roundingQuantity: number;    // default 0.001
  billingGraceDays: number;    // default 30
}

export const DEFAULT_SETTINGS: Omit<WorkspaceSettings, 'workspaceId'> = {
  materialityAbsolute: 100,
  materialityPct: 0.005,
  roundingCurrency: 0.01,
  roundingQuantity: 0.001,
  billingGraceDays: 30,
};

/** Structured calculation operands for provenance */
export interface CalculationJson {
  rule: string;
  operands: Record<string, unknown>;
  formula: string;
  result: number;
}

/** A finding draft produced by the pure AuditEngine before persistence */
export interface FindingDraft {
  rule: string;                      // e.g. "RULE_001"
  findingType: FindingType;
  financialDirection: FinancialDirection;
  severity: FindingSeverity;
  confidence: ConfidenceLevel;
  relatedRecords: Array<{ type: string; id: string }>;
  relatedFindingRefs: string[];      // rule+entityKey refs for grouping, resolved to IDs on persist
  amountSigned: number | null;       // positive = underbilled, negative = overbilled
  amountAtRisk: number;
  calculation: string;               // human-readable
  calculationJson: CalculationJson;
  explanation: string;
}

/** Normalized snapshot passed to the AuditEngine — pure, no DB dependencies */
export interface AuditSnapshot {
  projectId: string;
  workspaceId: string;
  asOfDate: string;                  // ISO date string e.g. "2025-08-15"
  settings: WorkspaceSettings;
  contractSovLines: ContractSOVLine[];
  changeOrders: ChangeOrder[];
  changeOrderLines: ChangeOrderLine[];
  tmTickets: TMTicket[];
  billingItems: BillingItem[];
  rateTables: RateTableEntry[];
  evidenceRecords: EvidenceRecord[];
  evidenceLinks: EvidenceLink[];
  matches: Match[];
}

/** Dashboard bucket totals (per spec: never blend into one number) */
export interface DashboardBuckets {
  potentialUnderbilling: number;
  potentialOverbilling: number;
  evidenceDisputeExposure: number;
  dataQualityCount: number;
}
