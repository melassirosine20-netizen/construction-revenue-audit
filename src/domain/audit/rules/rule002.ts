/**
 * RULE 002 — Approved CO Amount Variance (Partial / Over)
 * Spec: docs/03-detection-rules.md § RULE 002
 *
 * Condition:
 *  - CO status = approved
 *  - At least one linked billing record
 *  - |approved_amount − billed_amount| ≥ materiality
 *
 * Precedence: RULE 007 / 008 / 009 take priority when they explain the same variance.
 * RULE 002 fires as primary for lump-sum / no-explanatory-line variances.
 * When grouped with 007/008/009, RULE 002 still persists but is linked via relatedFindingRefs.
 *
 * Note: CO-019 overbilling is grouped with RULE 009 — RULE 002 fires but
 * the dashboard counts the CO-019 economic issue only ONCE.
 */
import type { AuditSnapshot, FindingDraft } from '../../types.js';
import { isMaterial } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

/** Lump-sum unit indicators for detecting LS change order lines */
const LUMP_SUM_UNITS = new Set(['LS', 'LUMP', 'LOT']);

export function runRule002(snapshot: AuditSnapshot): FindingDraft[] {
  const { changeOrders, changeOrderLines, billingItems, settings } = snapshot;
  const findings: FindingDraft[] = [];

  for (const co of changeOrders) {
    if (co.status !== 'approved') continue;

    // Linked billing items
    const linked = billingItems.filter(
      (b) => b.changeOrderId === co.changeOrderId,
    );
    if (linked.length === 0) continue; // No billing → RULE 001 territory

    const billedTotal = linked.reduce((sum, b) => sum + b.amount, 0);
    const variance = co.approvedAmount - billedTotal; // positive = underbilled

    if (!isMaterial(Math.abs(variance), settings, Math.abs(co.approvedAmount))) continue;

    // If the CO has non-lump-sum lines (unit_price / rate lines), those are handled by
    // RULE 007 (Quantity Mismatch) and RULE 008 (Rate Mismatch).
    // RULE 002 only operates on lump-sum / header-level COs where no explanatory line rules exist.
    const coLines = changeOrderLines.filter(
      (l) => l.changeOrderId === co.changeOrderId,
    );
    const hasNonLsLine = coLines.some(
      (l) =>
        l.rateType !== 'lump_sum' &&
        !LUMP_SUM_UNITS.has(l.unit.toUpperCase()),
    );
    if (hasNonLsLine) continue;

    const direction = variance > 0 ? 'UNDERBILLED' : 'OVERBILLED';
    const findingType =
      direction === 'UNDERBILLED' ? 'REVENUE_AT_RISK' : 'BILLING_MISMATCH';

    // relatedFindingRefs: if rule 009 will also fire (overbilling), mark for grouping.
    // The engine resolves these into actual IDs at persist time.
    const relatedFindingRefs: string[] = [];
    if (direction === 'OVERBILLED') {
      // Will be linked with RULE_009 for same CO if it fires
      relatedFindingRefs.push(`RULE_009:${co.changeOrderId}`);
    }
    if (hasNonLsLine) {
      // If RULE 007/008 fire on this CO, link them
      relatedFindingRefs.push(`RULE_007:${co.changeOrderId}`);
      relatedFindingRefs.push(`RULE_008:${co.changeOrderId}`);
    }

    const amountSigned = variance; // positive = underbilled, negative = overbilled
    const amountAtRisk = Math.abs(variance);

    findings.push({
      rule: 'RULE_002',
      findingType,
      financialDirection: direction,
      severity: scoreSeverity(amountAtRisk, direction),
      confidence: 'HIGH',
      relatedRecords: [
        { type: 'change_order', id: co.changeOrderId },
        ...linked.map((b) => ({ type: 'billing_item', id: b.billingId })),
      ],
      relatedFindingRefs,
      amountSigned,
      amountAtRisk,
      calculation:
        `Change Order ${co.changeOrderId} is approved at $${co.approvedAmount.toFixed(2)}. ` +
        `Linked billing totals $${billedTotal.toFixed(2)}. ` +
        `Variance: ${amountSigned > 0 ? '+' : ''}${amountSigned.toFixed(2)} ` +
        `(${direction.toLowerCase()}).`,
      calculationJson: {
        rule: 'RULE_002',
        operands: {
          change_order_id: co.changeOrderId,
          approved_amount: co.approvedAmount,
          billed_amount: billedTotal,
          variance,
          linked_invoice_ids: linked.map((b) => b.billingId),
        },
        formula: 'amount_signed = approved_amount - billed_amount',
        result: amountSigned,
      },
      explanation:
        `CO ${co.changeOrderId}: approved $${co.approvedAmount.toFixed(2)}, ` +
        `billed $${billedTotal.toFixed(2)}, ` +
        `variance $${Math.abs(variance).toFixed(2)} (${direction.toLowerCase()}).`,
    });
  }

  return findings;
}
