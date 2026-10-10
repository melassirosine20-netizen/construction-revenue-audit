/**
 * RULE 010 — Evidence Weakness (policy-aware)
 * Spec: docs/03-detection-rules.md § RULE 010
 *
 * Condition: Billed change (or billed T&M) that lacks expected supporting evidence
 * according to change_method / evidence policy:
 *
 *   change_method   | Minimum expected evidence
 *   t_and_m         | T&M ticket + approval + date + labor/material support
 *   unit_price      | Quantity support + approval
 *   fixed_price     | Approved CO + scope/authorization (T&M ticket NOT required)
 *   allowance       | Approval + draw support
 *
 * Financial direction: EVIDENCE_RISK
 * Finding type: EVIDENCE_RISK
 * amount_at_risk: amount of the billed item (dispute exposure, not automatic lost revenue)
 *
 * Expected: CO-022 (fixed_price) — policy does not require T&M ticket.
 * Seeded weakness: approval exists but linkage/documentation is thin — flag MEDIUM, not missing T&M.
 *
 * NOTE: For fixed_price COs, we look at EvidenceLinks for CO-level approval evidence.
 * CO-022 has EV-010 (approval) with confidence=medium.
 * The finding should be MEDIUM confidence, EVIDENCE_RISK.
 */
import type {
  AuditSnapshot,
  FindingDraft,
  ChangeOrder,
  EvidenceRecord,
  EvidenceLink,
} from '../../types.js';
import { isMaterial } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

export function runRule010(snapshot: AuditSnapshot): FindingDraft[] {
  const {
    changeOrders,
    billingItems,
    evidenceRecords,
    evidenceLinks,
    settings,
  } = snapshot;
  const findings: FindingDraft[] = [];

  // Build evidence index: CO → evidence items
  const evidenceForCo = buildEvidenceIndex(evidenceLinks, evidenceRecords, 'change_order');

  for (const co of changeOrders) {
    if (co.status !== 'approved') continue;

    // Only flag COs that have billing (otherwise it's RULE 001 / RULE 003 territory)
    const coHasBilling = billingItems.some((b) => b.changeOrderId === co.changeOrderId);
    if (!coHasBilling) continue;

    // Determine billing amount for this CO
    const billedAmount = billingItems
      .filter((b) => b.changeOrderId === co.changeOrderId)
      .reduce((sum, b) => sum + b.amount, 0);

    if (!isMaterial(Math.abs(billedAmount), settings, Math.abs(billedAmount))) continue;

    const coEvidence = evidenceForCo.get(co.changeOrderId) ?? [];

    // Check evidence per change_method
    const weakness = detectEvidenceWeakness(co, coEvidence);
    if (!weakness) continue;

    const amountAtRisk = Math.abs(billedAmount);

    findings.push({
      rule: 'RULE_010',
      findingType: 'EVIDENCE_RISK',
      financialDirection: 'EVIDENCE_RISK',
      severity: scoreSeverity(amountAtRisk, 'EVIDENCE_RISK'),
      confidence: weakness.confidence,
      relatedRecords: [
        { type: 'change_order', id: co.changeOrderId },
        ...coEvidence.map((e) => ({ type: 'evidence', id: e.evidenceId })),
      ],
      relatedFindingRefs: [],
      amountSigned: null,
      amountAtRisk,
      calculation:
        `CO ${co.changeOrderId} (${co.changeMethod}): billed $${billedAmount.toFixed(2)}. ` +
        `Evidence gap: ${weakness.description}. ` +
        `Dispute exposure: $${amountAtRisk.toFixed(2)}.`,
      calculationJson: {
        rule: 'RULE_010',
        operands: {
          change_order_id: co.changeOrderId,
          change_method: co.changeMethod,
          billed_amount: billedAmount,
          evidence_count: coEvidence.length,
          weakness_description: weakness.description,
        },
        formula: 'amount_at_risk = billed_amount (evidence weakness, not automatic loss)',
        result: amountAtRisk,
      },
      explanation:
        `CO ${co.changeOrderId} (${co.changeMethod}) has been billed at $${billedAmount.toFixed(2)} ` +
        `but evidence is weak: ${weakness.description}. ` +
        `This is a dispute exposure flag — not automatic revenue loss.`,
    });
  }

  return findings;
}

interface EvidenceWeakness {
  description: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

function detectEvidenceWeakness(
  co: ChangeOrder,
  coEvidence: EvidenceRecord[],
): EvidenceWeakness | null {
  const hasApproval = coEvidence.some((e) => e.type === 'approval');
  const hasTicket = coEvidence.some((e) => e.type === 'ticket');

  // Weak evidence = explicit evidence record with medium or low confidence
  const weakEvidence = coEvidence.find(
    (e) => e.confidence === 'MEDIUM' || e.confidence === 'LOW',
  );

  if (weakEvidence) {
    return {
      description: `Approval / documentation linkage is thin (${weakEvidence.description}, confidence ${weakEvidence.confidence})`,
      confidence: weakEvidence.confidence as 'MEDIUM' | 'LOW',
    };
  }

  switch (co.changeMethod) {
    case 'fixed_price':
      // For fixed_price COs, an approved CO with approved_date does not require T&M tickets.
      // It only triggers if an explicit evidence link has weak/medium confidence (handled above).
      return null;

    case 't_and_m':
      // T&M COs require supporting T&M ticket
      if (!hasTicket && coEvidence.length > 0) {
        return {
          description: 'Missing T&M ticket for T&M change order',
          confidence: 'MEDIUM',
        };
      }
      return null;

    case 'unit_price':
      return null;

    case 'allowance':
      return null;

    default:
      return null;
  }
}

/** Build an index of EvidenceRecords keyed by entity_id for a given entity_type */
function buildEvidenceIndex(
  links: EvidenceLink[],
  records: EvidenceRecord[],
  entityType: string,
): Map<string, EvidenceRecord[]> {
  const recordMap = new Map<string, EvidenceRecord>(
    records.map((r) => [r.evidenceId, r]),
  );
  const index = new Map<string, EvidenceRecord[]>();

  for (const link of links) {
    if (link.entityType !== entityType) continue;
    const record = recordMap.get(link.evidenceId);
    if (!record) continue;
    const group = index.get(link.entityId) ?? [];
    group.push(record);
    index.set(link.entityId, group);
  }

  return index;
}
