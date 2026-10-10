/**
 * Phase 4 — Matching service tests
 * Spec: docs/03-detection-rules.md · docs/17-implementation-plan-v1.md § Phase 4
 *
 * Pure matching — no DB required. Execution deferred if deps unavailable.
 */
import { describe, test, expect } from '@jest/globals';
import { runMatching } from '../../src/domain/matching/matching.js';
import type { ChangeOrder, BillingItem, TMTicket } from '../../src/domain/types.js';

function prov(id: string) {
  return {
    id,
    projectId: 'proj-1',
    workspaceId: 'ws-1',
    sourceDocumentId: 'doc-1',
    sourceImportId: 'imp-1',
    sourceRowOrPage: '2',
    rawValues: {},
    createdAt: '2025-08-15T00:00:00Z',
    updatedAt: '2025-08-15T00:00:00Z',
  };
}

function co(partial: Partial<ChangeOrder> & { changeOrderId: string }): ChangeOrder {
  return {
    ...prov(`co-${partial.changeOrderId}`),
    title: '',
    description: '',
    status: 'approved',
    changeMethod: 'fixed_price',
    submittedDate: null,
    approvedDate: '2025-03-20',
    effectiveDate: null,
    originalAmount: 1000,
    approvedAmount: 1000,
    customerReference: '',
    costCode: '',
    expectedBillAfter: null,
    sourceReference: '',
    ...partial,
  };
}

function bill(
  partial: Partial<BillingItem> & { billingId: string; lineId: string; amount: number },
): BillingItem {
  return {
    ...prov(`bill-${partial.billingId}-${partial.lineId}`),
    billingPeriod: '2025-03',
    invoiceNumber: partial.billingId,
    description: '',
    costCode: '',
    changeOrderId: null,
    changeOrderLineNumber: null,
    quantity: null,
    unitPrice: null,
    unit: null,
    retainage: null,
    billedToDate: null,
    billingDate: null,
    sourceReference: '',
    ...partial,
  };
}

function ticket(
  partial: Partial<TMTicket> & { ticketId: string; totalAmount: number },
): TMTicket {
  return {
    ...prov(`tm-${partial.ticketId}`),
    date: '2025-03-14',
    description: '',
    workerOrCategory: '',
    laborHours: 0,
    laborRate: 0,
    laborRateType: 'unknown',
    laborAmount: 0,
    materialAmount: 0,
    equipmentAmount: 0,
    approvalStatus: 'approved',
    customerSignature: false,
    billableStatus: 'billable',
    billingExpected: 'true',
    billingBasis: 'change_order',
    linkedChangeOrderId: null,
    expectedBillAfter: null,
    sourceReference: '',
    ...partial,
  };
}

describe('L1 exact_id matching', () => {
  test('billing with change_order_id matches the CO', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-001', approvedAmount: 4800 })],
      billingItems: [
        bill({
          billingId: 'INV-1',
          lineId: '1',
          amount: 4800,
          changeOrderId: 'CO-001',
        }),
      ],
      tmTickets: [],
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchMethod).toBe('exact_id');
    expect(result.matches[0].matchConfidence).toBe(1.0);
    expect(result.matches[0].targetId).toBe('CO-001');
    expect(result.matches[0].sourceType).toBe('billing_item');
  });

  test('ticket with linked_change_order_id matches the CO', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-001' })],
      billingItems: [],
      tmTickets: [ticket({ ticketId: 'TM-001', totalAmount: 100, linkedChangeOrderId: 'CO-001' })],
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].sourceType).toBe('tm_ticket');
    expect(result.matches[0].matchMethod).toBe('exact_id');
    expect(result.matches[0].targetId).toBe('CO-001');
  });

  test('does not invent CO link when ticket has no linked_change_order_id', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-001' })],
      billingItems: [],
      tmTickets: [ticket({ ticketId: 'TM-042', totalAmount: 500, linkedChangeOrderId: null })],
    });
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedTicketIds).toContain('TM-042');
  });

  test('billing referencing nonexistent CO is unmatched (no invent)', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-001' })],
      billingItems: [
        bill({ billingId: 'INV-9', lineId: '1', amount: 100, changeOrderId: 'CO-MISSING' }),
      ],
      tmTickets: [],
    });
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedBillingIds.some((id) => id.startsWith('INV-9'))).toBe(true);
  });
});

describe('Entity compatibility', () => {
  test('does not match billing to ticket merely because ids are equal', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [],
      billingItems: [
        bill({ billingId: 'TM-001', lineId: '1', amount: 100, changeOrderId: null }),
      ],
      tmTickets: [ticket({ ticketId: 'TM-001', totalAmount: 100 })],
    });
    // No CO targets; no billing↔ticket pairing exists
    expect(result.matches.every((m) => m.targetType === 'change_order')).toBe(true);
    expect(result.matches).toHaveLength(0);
  });
});

describe('L2 strong composite and ambiguity', () => {
  test('unique cost_code composite can match unmatched billing', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-010', costCode: '26-9999', approvedAmount: 500 })],
      billingItems: [
        bill({
          billingId: 'INV-X',
          lineId: '1',
          amount: 500,
          changeOrderId: null,
          costCode: '26-9999',
        }),
      ],
      tmTickets: [],
    });
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    const m = result.matches.find((x) => x.sourceId.startsWith('INV-X'));
    expect(m?.matchMethod).toBe('strong_composite');
    expect(m?.matchConfidence).toBeGreaterThanOrEqual(0.9);
    expect(m?.targetId).toBe('CO-010');
  });

  test('ambiguous cost_code does not auto-select a CO', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [
        co({ changeOrderId: 'CO-A', costCode: '26-0000', approvedAmount: 100 }),
        co({ changeOrderId: 'CO-B', costCode: '26-0000', approvedAmount: 200 }),
      ],
      billingItems: [
        bill({
          billingId: 'INV-AMB',
          lineId: '1',
          amount: 150,
          changeOrderId: null,
          costCode: '26-0000',
        }),
      ],
      tmTickets: [],
    });
    expect(result.matches.filter((m) => m.sourceId.startsWith('INV-AMB'))).toHaveLength(0);
    expect(result.candidates.some((c) => c.ambiguous)).toBe(true);
  });
});

describe('L3 structured attributes', () => {
  test('unique amount+cost_code match at medium confidence', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [
        co({ changeOrderId: 'CO-S', costCode: '26-7777', approvedAmount: 333.33 }),
        co({ changeOrderId: 'CO-OTHER', costCode: '26-0000', approvedAmount: 999 }),
      ],
      billingItems: [
        bill({
          billingId: 'INV-S',
          lineId: '1',
          amount: 333.33,
          changeOrderId: null,
          costCode: '26-7777',
        }),
      ],
      tmTickets: [],
    });
    // L2 unique cost_code may already match; either L2 or L3 is fine as long as unique
    const m = result.matches.find((x) => x.sourceId.startsWith('INV-S'));
    expect(m).toBeDefined();
    expect(m!.targetId).toBe('CO-S');
    expect(m!.matchConfidence).toBeLessThan(1.0);
  });
});

describe('Determinism and no fuzzy HIGH', () => {
  test('repeated runs produce same structural matches', () => {
    const input = {
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-001' })],
      billingItems: [
        bill({ billingId: 'INV-1', lineId: '1', amount: 10, changeOrderId: 'CO-001' }),
      ],
      tmTickets: [] as TMTicket[],
    };
    const a = runMatching(input);
    const b = runMatching(input);
    expect(a.matches.map((m) => `${m.sourceId}->${m.targetId}:${m.matchMethod}`)).toEqual(
      b.matches.map((m) => `${m.sourceId}->${m.targetId}:${m.matchMethod}`),
    );
  });

  test('never emits fuzzy_semantic method', () => {
    const result = runMatching({
      projectId: 'proj-1',
      changeOrders: [co({ changeOrderId: 'CO-001', approvedAmount: 100, costCode: 'X' })],
      billingItems: [
        bill({ billingId: 'INV-1', lineId: '1', amount: 99, changeOrderId: null, costCode: 'Y' }),
      ],
      tmTickets: [],
    });
    expect(result.matches.every((m) => m.matchMethod !== 'fuzzy_semantic')).toBe(true);
  });
});
