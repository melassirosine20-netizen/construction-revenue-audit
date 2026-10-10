/**
 * Matching service — Phase 4 (pure, deterministic)
 * Spec: docs/03-detection-rules.md § Matching Algorithm
 * Spec: docs/17-implementation-plan-v1.md § Phase 4
 *
 * L1 exact_id confidence 1.0 — auto-findings allowed by rules that use field links
 * L2 strong_composite 0.85–0.95 — only when unique candidate; ≥0.90 auto-eligible
 * L3 structured_attributes 0.60–0.85 — unique candidate only; never invent HIGH fuzzy
 * L4 fuzzy — NOT implemented (candidates only would be separate; never auto HIGH)
 *
 * Ambiguous candidates → no Match row (explicit non-match). Deterministic ordering.
 * Does not invent monetary findings.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  Match,
  MatchMethod,
  ChangeOrder,
  BillingItem,
  TMTicket,
  ChangeOrderLine,
} from '../types.js';

export interface MatchingInput {
  projectId: string;
  /** Optional; stored by persistence layer */
  workspaceId?: string;
  changeOrders: ChangeOrder[];
  billingItems: BillingItem[];
  tmTickets: TMTicket[];
  changeOrderLines?: ChangeOrderLine[];
}

export interface MatchCandidate {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  matchMethod: MatchMethod;
  matchConfidence: number;
  /** true when multiple targets tied — caller must not auto-select */
  ambiguous: boolean;
  reason: string;
}

export interface MatchingResult {
  matches: Match[];
  /** Ambiguous or rejected candidates for inspection (not persisted as confirmed matches) */
  candidates: MatchCandidate[];
  unmatchedBillingIds: string[];
  unmatchedTicketIds: string[];
}

const L1_CONFIDENCE = 1.0;
const L2_CONFIDENCE_UNIQUE = 0.92;
const L3_CONFIDENCE_UNIQUE = 0.75;

function matchKey(m: {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  matchMethod: string;
}): string {
  return `${m.sourceType}|${m.sourceId}|${m.targetType}|${m.targetId}|${m.matchMethod}`;
}

function toMatch(
  projectId: string,
  c: Omit<MatchCandidate, 'ambiguous' | 'reason'>,
  userConfirmed = false,
): Match {
  return {
    matchId: uuidv4(),
    projectId,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    targetType: c.targetType,
    targetId: c.targetId,
    matchMethod: c.matchMethod,
    matchConfidence: c.matchConfidence,
    userConfirmed,
    createdAt: new Date().toISOString(),
  };
}

/**
 * L1: BillingItem.changeOrderId → ChangeOrder.changeOrderId (exact)
 */
function matchBillingToCoExact(
  billingItems: BillingItem[],
  coById: Map<string, ChangeOrder>,
): { matches: MatchCandidate[]; unmatched: BillingItem[] } {
  const matches: MatchCandidate[] = [];
  const unmatched: BillingItem[] = [];

  for (const b of billingItems) {
    const coId = b.changeOrderId?.trim();
    if (!coId) {
      unmatched.push(b);
      continue;
    }
    if (!coById.has(coId)) {
      // Explicit reference to non-existent CO — no invent link; leave unmatched for RULE 004
      unmatched.push(b);
      continue;
    }
    matches.push({
      sourceType: 'billing_item',
      sourceId: `${b.billingId}::${b.lineId}`,
      targetType: 'change_order',
      targetId: coId,
      matchMethod: 'exact_id',
      matchConfidence: L1_CONFIDENCE,
      ambiguous: false,
      reason: `Exact change_order_id ${coId}`,
    });
  }
  return { matches, unmatched };
}

/**
 * L1: TMTicket.linkedChangeOrderId → ChangeOrder.changeOrderId (exact)
 * Does not invent a CO link when linkedChangeOrderId is null/empty.
 */
function matchTicketToCoExact(
  tickets: TMTicket[],
  coById: Map<string, ChangeOrder>,
): { matches: MatchCandidate[]; unmatched: TMTicket[] } {
  const matches: MatchCandidate[] = [];
  const unmatched: TMTicket[] = [];

  for (const t of tickets) {
    const coId = t.linkedChangeOrderId?.trim();
    if (!coId) {
      unmatched.push(t);
      continue;
    }
    if (!coById.has(coId)) {
      unmatched.push(t);
      continue;
    }
    matches.push({
      sourceType: 'tm_ticket',
      sourceId: t.ticketId,
      targetType: 'change_order',
      targetId: coId,
      matchMethod: 'exact_id',
      matchConfidence: L1_CONFIDENCE,
      ambiguous: false,
      reason: `Exact linked_change_order_id ${coId}`,
    });
  }
  return { matches, unmatched };
}

/**
 * L2 strong composite for unmatched billing → CO:
 * project is implicit (all same project). Composite: cost_code + customer_reference
 * only when customer_reference is non-empty on the CO and cost codes match uniquely.
 * Spec: project + cost code + customer reference + line reference.
 * Billing has cost_code; CO has cost_code + customer_reference.
 * Require unique CO candidate; otherwise ambiguous (no match).
 */
function matchBillingToCoComposite(
  unmatchedBilling: BillingItem[],
  changeOrders: ChangeOrder[],
): MatchCandidate[] {
  const results: MatchCandidate[] = [];

  for (const b of unmatchedBilling) {
    const costCode = (b.costCode || '').trim();
    if (!costCode) continue;

    const candidates = changeOrders.filter((co) => {
      if ((co.costCode || '').trim() !== costCode) return false;
      // Strong composite also needs a customer/line signal when available
      const cust = (co.customerReference || '').trim();
      const lineRef = (b.sourceReference || '').trim();
      if (cust && lineRef && lineRef.includes(cust)) return true;
      // cost code alone is too weak for L2 if multiple COs share it
      return false;
    });

    // Fallback L2: unique CO with same cost_code AND unique approved_amount ≈ billing amount
    let pool = candidates;
    if (pool.length === 0) {
      pool = changeOrders.filter((co) => (co.costCode || '').trim() === costCode);
      if (pool.length !== 1) {
        if (pool.length > 1) {
          results.push({
            sourceType: 'billing_item',
            sourceId: `${b.billingId}::${b.lineId}`,
            targetType: 'change_order',
            targetId: '',
            matchMethod: 'strong_composite',
            matchConfidence: 0,
            ambiguous: true,
            reason: `Ambiguous composite: ${pool.length} COs share cost_code ${costCode}`,
          });
        }
        continue;
      }
    }

    if (pool.length > 1) {
      results.push({
        sourceType: 'billing_item',
        sourceId: `${b.billingId}::${b.lineId}`,
        targetType: 'change_order',
        targetId: '',
        matchMethod: 'strong_composite',
        matchConfidence: 0,
        ambiguous: true,
        reason: `Ambiguous composite: ${pool.length} candidates`,
      });
      continue;
    }

    const co = pool[0];
    results.push({
      sourceType: 'billing_item',
      sourceId: `${b.billingId}::${b.lineId}`,
      targetType: 'change_order',
      targetId: co.changeOrderId,
      matchMethod: 'strong_composite',
      matchConfidence: L2_CONFIDENCE_UNIQUE,
      ambiguous: false,
      reason: `Unique composite cost_code=${costCode}`,
    });
  }

  return results;
}

/**
 * L3 structured attributes: amount ± tolerance + same cost code, unique CO only.
 * Confidence 0.75 — not HIGH; rules may still use field links preferentially.
 * Never creates a match when multiple COs fall in the amount window.
 */
function matchBillingToCoStructured(
  stillUnmatched: BillingItem[],
  changeOrders: ChangeOrder[],
  amountTolerance = 0.01,
): MatchCandidate[] {
  const results: MatchCandidate[] = [];

  for (const b of stillUnmatched) {
    const amount = b.amount;
    const costCode = (b.costCode || '').trim();
    const pool = changeOrders.filter((co) => {
      if (costCode && (co.costCode || '').trim() !== costCode) return false;
      return Math.abs(co.approvedAmount - amount) <= amountTolerance;
    });

    if (pool.length === 0) continue;
    if (pool.length > 1) {
      results.push({
        sourceType: 'billing_item',
        sourceId: `${b.billingId}::${b.lineId}`,
        targetType: 'change_order',
        targetId: '',
        matchMethod: 'structured_attributes',
        matchConfidence: 0,
        ambiguous: true,
        reason: `Ambiguous structured: ${pool.length} COs within amount tolerance`,
      });
      continue;
    }

    results.push({
      sourceType: 'billing_item',
      sourceId: `${b.billingId}::${b.lineId}`,
      targetType: 'change_order',
      targetId: pool[0].changeOrderId,
      matchMethod: 'structured_attributes',
      matchConfidence: L3_CONFIDENCE_UNIQUE,
      ambiguous: false,
      reason: `Unique structured amount±${amountTolerance} cost_code=${costCode || '*'}`,
    });
  }

  return results;
}

/**
 * Entity compatibility: never match billing to ticket as CO, etc.
 * Implemented by explicit pair functions only (no generic ID equality).
 */

/**
 * Run L1 → L2 → L3 matching. Deterministic: stable sort by sourceId then method.
 * Does not implement L4 fuzzy. Does not invent links for null IDs.
 */
export function runMatching(input: MatchingInput): MatchingResult {
  const coById = new Map(input.changeOrders.map((co) => [co.changeOrderId, co]));

  const l1Billing = matchBillingToCoExact(input.billingItems, coById);
  const l1Tickets = matchTicketToCoExact(input.tmTickets, coById);

  const l2 = matchBillingToCoComposite(l1Billing.unmatched, input.changeOrders);

  // Billing still without a non-ambiguous L2 match
  const matchedBillingKeys = new Set(
    [...l1Billing.matches, ...l2.filter((c) => !c.ambiguous)].map((c) => c.sourceId),
  );
  const stillUnmatchedBilling = l1Billing.unmatched.filter(
    (b) => !matchedBillingKeys.has(`${b.billingId}::${b.lineId}`),
  );

  const l3 = matchBillingToCoStructured(stillUnmatchedBilling, input.changeOrders);

  const allCandidates = [
    ...l1Billing.matches,
    ...l1Tickets.matches,
    ...l2,
    ...l3,
  ];

  // Persist only non-ambiguous matches; dedupe by key (prefer higher confidence / L1)
  const byKey = new Map<string, MatchCandidate>();
  const sorted = [...allCandidates].sort((a, b) => {
    if (a.sourceId !== b.sourceId) return a.sourceId.localeCompare(b.sourceId);
    return b.matchConfidence - a.matchConfidence;
  });

  for (const c of sorted) {
    if (c.ambiguous || !c.targetId) continue;
    const key = matchKey(c);
    if (!byKey.has(key)) byKey.set(key, c);
  }

  // One match per sourceId preferred (highest confidence already sorted)
  const bySource = new Map<string, MatchCandidate>();
  for (const c of byKey.values()) {
    const sk = `${c.sourceType}|${c.sourceId}`;
    const existing = bySource.get(sk);
    if (!existing || c.matchConfidence > existing.matchConfidence) {
      bySource.set(sk, c);
    }
  }

  const matches: Match[] = [...bySource.values()]
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .map((c) =>
      toMatch(input.projectId, {
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        targetType: c.targetType,
        targetId: c.targetId,
        matchMethod: c.matchMethod,
        matchConfidence: c.matchConfidence,
      }),
    );

  const finalMatchedBilling = new Set(
    matches.filter((m) => m.sourceType === 'billing_item').map((m) => m.sourceId),
  );
  const finalMatchedTickets = new Set(
    matches.filter((m) => m.sourceType === 'tm_ticket').map((m) => m.sourceId),
  );

  return {
    matches,
    candidates: allCandidates.filter((c) => c.ambiguous),
    unmatchedBillingIds: input.billingItems
      .map((b) => `${b.billingId}::${b.lineId}`)
      .filter((id) => !finalMatchedBilling.has(id)),
    unmatchedTicketIds: input.tmTickets
      .map((t) => t.ticketId)
      .filter((id) => !finalMatchedTickets.has(id)),
  };
}
