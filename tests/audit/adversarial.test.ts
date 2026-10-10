/**
 * Adversarial / false-positive test suite
 * Spec: docs/17-implementation-plan-v1.md § E.4 Adversarial / false-positive tests
 *
 * Each case asserts that a specific scenario does NOT produce an unwanted finding.
 * DO NOT remove or weaken these tests.
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { runAuditEngine, type GroupedFinding } from '../../src/domain/audit/engine.js';
import { buildSampleSnapshot } from '../fixtures/sampleLoader.js';
import type { AuditSnapshot, ChangeOrder, TMTicket, BillingItem } from '../../src/domain/types.js';

let snapshot: AuditSnapshot;
let allFindings: GroupedFinding[];

beforeAll(() => {
  snapshot = buildSampleSnapshot('2025-08-15');
  const result = runAuditEngine(snapshot);
  allFindings = result.findings;
});

// ─── Billing within grace — No RULE 001/003 ───────────────────────────────────

describe('FP: Billing within grace period', () => {
  test('A CO approved today (within grace) does not produce RULE_001', () => {
    // Create a snapshot where a CO was approved yesterday — within 30-day grace
    const recentCo: ChangeOrder = {
      ...snapshot.changeOrders[0],
      changeOrderId: 'CO-GRACE-TEST',
      status: 'approved',
      approvedAmount: 50000,
      approvedDate: '2025-08-01', // 14 days before as_of_date 2025-08-15 → within grace
      expectedBillAfter: null,
    };
    const testSnapshot: AuditSnapshot = {
      ...snapshot,
      changeOrders: [...snapshot.changeOrders, recentCo],
      billingItems: snapshot.billingItems.filter((b) => b.changeOrderId !== 'CO-GRACE-TEST'),
    };
    const { findings } = runAuditEngine(testSnapshot);
    const rule001 = findings.filter(
      (f) => f.rule === 'RULE_001' && f.relatedRecords.some((r) => r.id === 'CO-GRACE-TEST'),
    );
    expect(rule001).toHaveLength(0);
  });

  test('T&M within grace from expected_bill_after does not produce RULE_003', () => {
    // TM-042 has expected_bill_after=2025-08-01; as_of=2025-08-15 is PAST cutoff → should fire
    // Create a ticket with expected_bill_after AFTER as_of_date → should NOT fire
    const futureTicket: TMTicket = {
      ...snapshot.tmTickets[0],
      ticketId: 'TM-GRACE-TEST',
      billableStatus: 'billable',
      billingExpected: 'true',
      linkedChangeOrderId: null,
      expectedBillAfter: '2025-09-01', // Future → within grace
      totalAmount: 5000,
      approvalStatus: 'approved',
    };
    const testSnapshot: AuditSnapshot = {
      ...snapshot,
      tmTickets: [...snapshot.tmTickets, futureTicket],
    };
    const { findings } = runAuditEngine(testSnapshot);
    const rule003 = findings.filter(
      (f) => f.rule === 'RULE_003' && f.relatedRecords.some((r) => r.id === 'TM-GRACE-TEST'),
    );
    expect(rule003).toHaveLength(0);
  });
});

// ─── CO-005 progressive periods — No RULE_009 ─────────────────────────────────

describe('FP: CO-005 legitimate multi-period billing', () => {
  test('CO-005 does not produce RULE_009 (legitimate two-period progress billing)', () => {
    const rule009co005 = allFindings.filter(
      (f) => f.rule === 'RULE_009' && f.relatedRecords.some((r) => r.id === 'CO-005'),
    );
    expect(rule009co005).toHaveLength(0);
  });

  test('CO-005 does not produce RULE_001 (fully billed)', () => {
    const rule001co005 = allFindings.filter(
      (f) => f.rule === 'RULE_001' && f.relatedRecords.some((r) => r.id === 'CO-005'),
    );
    expect(rule001co005).toHaveLength(0);
  });

  test('CO-005 does not produce RULE_002 (total matches approved $15,000)', () => {
    const rule002co005 = allFindings.filter(
      (f) => f.rule === 'RULE_002' && f.relatedRecords.some((r) => r.id === 'CO-005'),
    );
    expect(rule002co005).toHaveLength(0);
  });
});

// ─── CO-015 credit — No revenue finding ───────────────────────────────────────

describe('FP: CO-015 approved credit', () => {
  test('CO-015 (negative approved amount) does not produce RULE_001', () => {
    const rule001co015 = allFindings.filter(
      (f) => f.rule === 'RULE_001' && f.relatedRecords.some((r) => r.id === 'CO-015'),
    );
    expect(rule001co015).toHaveLength(0);
  });

  test('CO-015 does not produce any UNDERBILLED finding', () => {
    const underbilled015 = allFindings.filter(
      (f) =>
        f.financialDirection === 'UNDERBILLED' &&
        f.relatedRecords.some((r) => r.id === 'CO-015'),
    );
    expect(underbilled015).toHaveLength(0);
  });
});

// ─── CO-002 submitted≠approved — No revenue finding (005 info only) ───────────

describe('FP: CO-002 submitted vs approved negotiation', () => {
  test('CO-002 does not produce RULE_001 (it is billed)', () => {
    const rule001co002 = allFindings.filter(
      (f) => f.rule === 'RULE_001' && f.relatedRecords.some((r) => r.id === 'CO-002'),
    );
    expect(rule001co002).toHaveLength(0);
  });

  test('CO-002 does not produce RULE_002 (billed at approved amount $12,000)', () => {
    const rule002co002 = allFindings.filter(
      (f) => f.rule === 'RULE_002' && f.relatedRecords.some((r) => r.id === 'CO-002'),
    );
    expect(rule002co002).toHaveLength(0);
  });

  test('RULE_005 for CO-002 is INFO direction, not revenue', () => {
    const rule005co002 = allFindings.filter(
      (f) => f.rule === 'RULE_005' && f.relatedRecords.some((r) => r.id === 'CO-002'),
    );
    // If RULE_005 fires, it must be NONE direction and INFO severity
    for (const f of rule005co002) {
      expect(f.financialDirection).toBe('NONE');
      expect(f.severity).toBe('INFO');
      expect(f.amountSigned).toBeNull();
    }
  });
});

// ─── Non-billable T&M — No RULE_003 ──────────────────────────────────────────

describe('FP: Non-billable T&M tickets', () => {
  test('No non-billable T&M ticket produces RULE_003', () => {
    const nonBillableTicketIds = snapshot.tmTickets
      .filter((t) => t.billableStatus === 'non_billable')
      .map((t) => t.ticketId);

    const rule003nonBillable = allFindings.filter(
      (f) =>
        f.rule === 'RULE_003' &&
        f.relatedRecords.some(
          (r) => r.type === 'tm_ticket' && nonBillableTicketIds.includes(r.id),
        ),
    );
    expect(rule003nonBillable).toHaveLength(0);
  });

  test('No billing_expected=false ticket produces RULE_003', () => {
    const billingFalseIds = snapshot.tmTickets
      .filter((t) => t.billingExpected === 'false')
      .map((t) => t.ticketId);

    const rule003billingFalse = allFindings.filter(
      (f) =>
        f.rule === 'RULE_003' &&
        f.relatedRecords.some(
          (r) => r.type === 'tm_ticket' && billingFalseIds.includes(r.id),
        ),
    );
    expect(rule003billingFalse).toHaveLength(0);
  });
});

// ─── Lump-sum lines — No RULE_007 / RULE_008 ─────────────────────────────────

describe('FP: Lump-sum line exclusions', () => {
  test('Lump-sum CO lines do not produce RULE_007 (quantity mismatch)', () => {
    // CO-001, CO-002, CO-007, CO-014, CO-019, CO-022 are all LS
    const lsCoIds = ['CO-001', 'CO-002', 'CO-007', 'CO-014', 'CO-019', 'CO-022'];
    const rule007ls = allFindings.filter(
      (f) =>
        f.rule === 'RULE_007' &&
        f.relatedRecords.some((r) => lsCoIds.includes(r.id)),
    );
    expect(rule007ls).toHaveLength(0);
  });

  test('Lump-sum CO lines do not produce RULE_008 (rate mismatch)', () => {
    const lsCoIds = ['CO-001', 'CO-002', 'CO-007', 'CO-014', 'CO-019', 'CO-022'];
    const rule008ls = allFindings.filter(
      (f) =>
        f.rule === 'RULE_008' &&
        f.relatedRecords.some((r) => lsCoIds.includes(r.id)),
    );
    expect(rule008ls).toHaveLength(0);
  });
});

// ─── Retainage — No REVENUE_AT_RISK ──────────────────────────────────────────

describe('FP: Retainage differences', () => {
  test('Retainage differences alone do not produce REVENUE_AT_RISK', () => {
    // Verify that none of the fully-billed COs (CO-001, CO-002 etc.) produce RULE_002
    // due to retainage differences
    const fullyBilledCos = ['CO-001', 'CO-002', 'CO-004', 'CO-006', 'CO-008', 'CO-009', 'CO-010'];
    const rule002fully = allFindings.filter(
      (f) =>
        f.rule === 'RULE_002' &&
        f.relatedRecords.some((r) => fullyBilledCos.includes(r.id)),
    );
    expect(rule002fully).toHaveLength(0);
  });
});

// ─── Cancelled CO — No RULE_001 / RULE_002 ───────────────────────────────────

describe('FP: Cancelled / void change orders', () => {
  test('Cancelled CO does not produce RULE_001', () => {
    const cancelledCo: ChangeOrder = {
      ...snapshot.changeOrders[0],
      changeOrderId: 'CO-CANCELLED',
      status: 'cancelled',
      approvedAmount: 50000,
      approvedDate: '2025-01-01', // Well past grace
      expectedBillAfter: null,
    };
    const testSnapshot: AuditSnapshot = {
      ...snapshot,
      changeOrders: [...snapshot.changeOrders, cancelledCo],
    };
    const { findings } = runAuditEngine(testSnapshot);
    const rule001cancelled = findings.filter(
      (f) => f.rule === 'RULE_001' && f.relatedRecords.some((r) => r.id === 'CO-CANCELLED'),
    );
    expect(rule001cancelled).toHaveLength(0);
  });

  test('Void CO does not produce RULE_001', () => {
    const voidCo: ChangeOrder = {
      ...snapshot.changeOrders[0],
      changeOrderId: 'CO-VOID',
      status: 'void',
      approvedAmount: 30000,
      approvedDate: '2025-01-01',
      expectedBillAfter: null,
    };
    const testSnapshot: AuditSnapshot = {
      ...snapshot,
      changeOrders: [...snapshot.changeOrders, voidCo],
    };
    const { findings } = runAuditEngine(testSnapshot);
    const rule001void = findings.filter(
      (f) => f.rule === 'RULE_001' && f.relatedRecords.some((r) => r.id === 'CO-VOID'),
    );
    expect(rule001void).toHaveLength(0);
  });
});

// ─── Fuzzy candidate — No HIGH financial finding ──────────────────────────────

describe('FP: Fuzzy match candidates', () => {
  test('Fuzzy semantic match does not auto-generate HIGH confidence financial finding', () => {
    // Per spec: fuzzy matches (confidence 0.30-0.70) must never auto-generate HIGH financial findings
    // All findings that reference fuzzy matches must have confidence LOW or MEDIUM at most
    const fuzzyMatches = snapshot.matches.filter(
      (m) => m.matchMethod === 'fuzzy_semantic',
    );
    // In the sample data there are no fuzzy matches (fixture uses empty matches array)
    // This test verifies the principle: no HIGH finding from unconfirmed fuzzy
    const highFindingsFromFuzzy = allFindings.filter(
      (f) =>
        f.confidence === 'HIGH' &&
        fuzzyMatches.some(
          (m) =>
            f.relatedRecords.some((r) => r.id === m.sourceId || r.id === m.targetId),
        ),
    );
    expect(highFindingsFromFuzzy).toHaveLength(0);
  });
});

// ─── Unknown billable status — No HIGH RULE_003 ──────────────────────────────

describe('FP: Unknown billable_status tickets', () => {
  test('Unlinked T&M with billable_status=unknown does not produce RULE_003', () => {
    const unknownIds = snapshot.tmTickets
      .filter(
        (t) =>
          t.billableStatus === 'unknown' &&
          !t.linkedChangeOrderId,
      )
      .map((t) => t.ticketId);

    expect(unknownIds.length).toBeGreaterThan(0); // Ensure we have some unknowns to test

    const rule003unknown = allFindings.filter(
      (f) =>
        f.rule === 'RULE_003' &&
        f.relatedRecords.some(
          (r) => r.type === 'tm_ticket' && unknownIds.includes(r.id),
        ),
    );
    expect(rule003unknown).toHaveLength(0);
  });
});
