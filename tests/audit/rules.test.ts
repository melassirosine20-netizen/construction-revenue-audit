/**
 * Per-rule unit tests — E.3 Per-rule unit tests
 * Spec: docs/17-implementation-plan-v1.md § E.3
 *
 * For each rule: inputs → single finding or empty; cover materiality boundary, grace period,
 * cancelled status, credit.
 */
import { describe, test, expect } from '@jest/globals';
import { runRule001 } from '../../src/domain/audit/rules/rule001.js';
import { runRule002 } from '../../src/domain/audit/rules/rule002.js';
import { runRule003 } from '../../src/domain/audit/rules/rule003.js';
import { runRule006 } from '../../src/domain/audit/rules/rule006.js';
import { runRule007 } from '../../src/domain/audit/rules/rule007.js';
import { runRule008 } from '../../src/domain/audit/rules/rule008.js';
import { runRule009 } from '../../src/domain/audit/rules/rule009.js';
import { isMaterial } from '../../src/domain/audit/materiality.js';
import type { AuditSnapshot, ChangeOrder, TMTicket, WorkspaceSettings } from '../../src/domain/types.js';
import { DEFAULT_SETTINGS } from '../../src/domain/types.js';
import { buildSampleSnapshot } from '../fixtures/sampleLoader.js';

const BASE_SETTINGS: WorkspaceSettings = {
  workspaceId: 'ws-unit-test',
  ...DEFAULT_SETTINGS,
};

function baseSnapshot(overrides?: Partial<AuditSnapshot>): AuditSnapshot {
  return {
    projectId: 'PRJ-UNIT',
    workspaceId: 'ws-unit-test',
    asOfDate: '2025-08-15',
    settings: BASE_SETTINGS,
    contractSovLines: [],
    changeOrders: [],
    changeOrderLines: [],
    tmTickets: [],
    billingItems: [],
    rateTables: [],
    evidenceRecords: [],
    evidenceLinks: [],
    matches: [],
    ...overrides,
  };
}

const makeCo = (overrides: Partial<ChangeOrder>): ChangeOrder => ({
  id: 'co-unit-1',
  projectId: 'PRJ-UNIT',
  workspaceId: 'ws-unit-test',
  sourceDocumentId: 'doc-1',
  sourceImportId: 'imp-1',
  sourceRowOrPage: '1',
  rawValues: {},
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  changeOrderId: 'CO-UNIT',
  title: 'Unit test CO',
  description: 'Unit test',
  status: 'approved',
  changeMethod: 'fixed_price',
  submittedDate: '2025-01-01',
  approvedDate: '2025-01-10',
  effectiveDate: '2025-01-12',
  originalAmount: 10000,
  approvedAmount: 10000,
  customerReference: 'COR-UNIT',
  costCode: '26-0000',
  expectedBillAfter: null,
  sourceReference: 'CO-UNIT-REF',
  ...overrides,
});

// ─── Materiality unit tests ───────────────────────────────────────────────────

describe('Materiality', () => {
  test('Amount of $99 below default $100 threshold is not material', () => {
    expect(isMaterial(99, BASE_SETTINGS)).toBe(false);
  });

  test('Amount of $100 exactly meets threshold', () => {
    expect(isMaterial(100, BASE_SETTINGS)).toBe(true);
  });

  test('0.5% of $25,000 = $125 is material (> $100 absolute)', () => {
    expect(isMaterial(125, BASE_SETTINGS, 25000)).toBe(true);
  });

  test('0.4% of $10,000 = $40 is NOT material (< $100 threshold)', () => {
    expect(isMaterial(40, BASE_SETTINGS, 10000)).toBe(false);
  });

  test('0.6% of $50,000 = $300 is material (> $100)', () => {
    expect(isMaterial(300, BASE_SETTINGS, 50000)).toBe(true);
  });
});

// ─── RULE 001 unit tests ──────────────────────────────────────────────────────

describe('RULE_001 unit tests', () => {
  test('Approved CO with no billing past grace produces finding', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedDate: '2025-01-01', approvedAmount: 5000 })],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('RULE_001');
    expect(findings[0].financialDirection).toBe('UNDERBILLED');
  });

  test('Approved CO within 30-day grace does not produce finding', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedDate: '2025-08-01', approvedAmount: 5000 })],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(0);
  });

  test('Cancelled CO does not produce RULE_001', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ status: 'cancelled', approvedDate: '2025-01-01' })],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(0);
  });

  test('Credit CO (negative amount) does not produce RULE_001', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedAmount: -3000, approvedDate: '2025-01-01' })],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(0);
  });

  test('CO below materiality ($99) does not produce finding', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedAmount: 99, approvedDate: '2025-01-01' })],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(0);
  });

  test('CO with expected_bill_after in future does not produce finding', () => {
    const snapshot = baseSnapshot({
      changeOrders: [
        makeCo({
          approvedDate: '2025-01-01',
          expectedBillAfter: '2025-09-01', // Future
        }),
      ],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(0);
  });

  test('CO with some billing does not produce RULE_001 (belongs to RULE_002)', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedDate: '2025-01-01', approvedAmount: 10000 })],
      billingItems: [
        {
          id: 'bi-1',
          projectId: 'PRJ-UNIT',
          workspaceId: 'ws-unit-test',
          sourceDocumentId: 'doc-1',
          sourceImportId: 'imp-1',
          sourceRowOrPage: '1',
          rawValues: {},
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          billingId: 'INV-UNIT-001',
          billingPeriod: '2025-02',
          invoiceNumber: 'INV-001',
          lineId: '1',
          description: 'Partial billing',
          costCode: '26-0000',
          changeOrderId: 'CO-UNIT',
          changeOrderLineNumber: null,
          amount: 5000,
          quantity: null,
          unitPrice: null,
          unit: null,
          retainage: null,
          billedToDate: 5000,
          billingDate: null,
          sourceReference: 'PA-001',
        },
      ],
    });
    const findings = runRule001(snapshot);
    expect(findings).toHaveLength(0);
  });
});

// ─── RULE 002 unit tests ──────────────────────────────────────────────────────

describe('RULE_002 unit tests', () => {
  test('Partially billed CO produces UNDERBILLED finding', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedAmount: 10000, approvedDate: '2025-01-01' })],
      billingItems: [
        {
          id: 'bi-1', projectId: 'PRJ-UNIT', workspaceId: 'ws-unit-test',
          sourceDocumentId: 'doc-1', sourceImportId: 'imp-1', sourceRowOrPage: '1',
          rawValues: {}, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
          billingId: 'INV-001', billingPeriod: '2025-02', invoiceNumber: 'INV-001',
          lineId: '1', description: 'Partial', costCode: '26-0000', changeOrderId: 'CO-UNIT',
          changeOrderLineNumber: null, amount: 7000, quantity: null, unitPrice: null,
          unit: null, retainage: null, billedToDate: 7000, billingDate: null, sourceReference: 'PA-001',
        },
      ],
    });
    const findings = runRule002(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].financialDirection).toBe('UNDERBILLED');
    expect(findings[0].amountSigned).toBe(3000);
  });

  test('Overbilled CO produces OVERBILLED finding', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ approvedAmount: 5000, approvedDate: '2025-01-01' })],
      billingItems: [
        {
          id: 'bi-1', projectId: 'PRJ-UNIT', workspaceId: 'ws-unit-test',
          sourceDocumentId: 'doc-1', sourceImportId: 'imp-1', sourceRowOrPage: '1',
          rawValues: {}, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
          billingId: 'INV-001', billingPeriod: '2025-02', invoiceNumber: 'INV-001',
          lineId: '1', description: 'Overbill', costCode: '26-0000', changeOrderId: 'CO-UNIT',
          changeOrderLineNumber: null, amount: 8000, quantity: null, unitPrice: null,
          unit: null, retainage: null, billedToDate: 8000, billingDate: null, sourceReference: 'PA-001',
        },
      ],
    });
    const findings = runRule002(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].financialDirection).toBe('OVERBILLED');
    expect(findings[0].amountSigned).toBe(-3000);
  });
});

// ─── RULE_003 unit tests ──────────────────────────────────────────────────────

describe('RULE_003 unit tests', () => {
  const baseTicket: TMTicket = {
    id: 'tm-unit-1', projectId: 'PRJ-UNIT', workspaceId: 'ws-unit-test',
    sourceDocumentId: 'doc-1', sourceImportId: 'imp-1', sourceRowOrPage: '1',
    rawValues: {}, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    ticketId: 'TM-UNIT',
    date: '2025-01-10',
    description: 'Unit test work',
    workerOrCategory: 'Electrician',
    laborHours: 10,
    laborRate: 85,
    laborRateType: 'labor_bill',
    laborAmount: 850,
    materialAmount: 200,
    equipmentAmount: 0,
    totalAmount: 1050,
    approvalStatus: 'approved',
    customerSignature: true,
    billableStatus: 'billable',
    billingExpected: 'true',
    billingBasis: 't_and_m',
    linkedChangeOrderId: null,
    expectedBillAfter: null,
    sourceReference: 'TM-REF',
  };

  test('Billable approved ticket past grace with no CO produces RULE_003', () => {
    const snapshot = baseSnapshot({ tmTickets: [baseTicket] });
    const findings = runRule003(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('RULE_003');
    expect(findings[0].confidence).toBe('HIGH');
  });

  test('non_billable ticket does NOT produce RULE_003', () => {
    const snapshot = baseSnapshot({
      tmTickets: [{ ...baseTicket, billableStatus: 'non_billable' }],
    });
    expect(runRule003(snapshot)).toHaveLength(0);
  });

  test('billing_expected=false ticket does NOT produce RULE_003', () => {
    const snapshot = baseSnapshot({
      tmTickets: [{ ...baseTicket, billingExpected: 'false' }],
    });
    expect(runRule003(snapshot)).toHaveLength(0);
  });

  test('unknown billable_status does NOT produce RULE_003', () => {
    const snapshot = baseSnapshot({
      tmTickets: [{ ...baseTicket, billableStatus: 'unknown' }],
    });
    expect(runRule003(snapshot)).toHaveLength(0);
  });

  test('Ticket within grace does NOT produce RULE_003', () => {
    const snapshot = baseSnapshot({
      tmTickets: [{ ...baseTicket, expectedBillAfter: '2025-09-01' }],
    });
    expect(runRule003(snapshot)).toHaveLength(0);
  });

  test('Ticket linked to a CO does NOT produce RULE_003', () => {
    const snapshot = baseSnapshot({
      changeOrders: [makeCo({ changeOrderId: 'CO-LINKED' })],
      tmTickets: [{ ...baseTicket, linkedChangeOrderId: 'CO-LINKED' }],
    });
    expect(runRule003(snapshot)).toHaveLength(0);
  });
});

// ─── RULE_007 / RULE_008 — Sample data checks ────────────────────────────────

describe('RULE_007 sample data: CO-003 quantity mismatch', () => {
  test('RULE_007 detects CO-003 40 LF underbilling', () => {
    const snapshot = buildSampleSnapshot('2025-08-15');
    const findings = runRule007(snapshot);
    const co003 = findings.find(
      (f) => f.relatedRecords.some((r) => r.id === 'CO-003'),
    );
    expect(co003).toBeDefined();
    expect(co003!.amountSigned).toBeCloseTo(3440, 1);
  });
});

describe('RULE_008 sample data: CO-011 rate mismatch', () => {
  test('RULE_008 detects CO-011 $700 underbilling', () => {
    const snapshot = buildSampleSnapshot('2025-08-15');
    const findings = runRule008(snapshot);
    const co011 = findings.find(
      (f) => f.relatedRecords.some((r) => r.id === 'CO-011'),
    );
    expect(co011).toBeDefined();
    expect(co011!.amountSigned).toBeCloseTo(700, 1);
  });
});

describe('RULE_009 sample data: CO-019 duplicate', () => {
  test('RULE_009 detects CO-019 duplicate billing', () => {
    const snapshot = buildSampleSnapshot('2025-08-15');
    const findings = runRule009(snapshot);
    const co019 = findings.find(
      (f) => f.relatedRecords.some((r) => r.id === 'CO-019'),
    );
    expect(co019).toBeDefined();
    expect(co019!.amountSigned).toBeCloseTo(-11200, 1);
    expect(co019!.financialDirection).toBe('OVERBILLED');
  });

  test('RULE_009 does NOT fire for CO-005 (legitimate progress billing)', () => {
    const snapshot = buildSampleSnapshot('2025-08-15');
    const findings = runRule009(snapshot);
    const co005 = findings.find(
      (f) => f.relatedRecords.some((r) => r.id === 'CO-005'),
    );
    expect(co005).toBeUndefined();
  });
});
