/**
 * RULE 007 — Quantity Mismatch
 * Spec: docs/03-detection-rules.md § RULE 007
 *
 * Condition:
 *  - ChangeOrderLine exists with explicit quantity and unit
 *  - unit is NOT a lump-sum unit (LS, LUMP, LOT)
 *  - Linked BillingItem has explicit quantity and compatible unit
 *  - |approved_qty − billed_qty| ≥ materiality (quantity tolerance)
 *
 * amount_signed = (approved_qty − billed_qty) × approved_unit_price
 *
 * FORBIDDEN:
 *  - Inferring quantity = header_amount / unit_price when no line quantity exists
 *  - Applying to lump-sum lines
 *
 * Expected for sample data:
 *   CO-003 line 1: 100 LF × $86 approved; billing 60 LF × $86 = $5,160
 *   Underbilled 40 LF × $86 = $3,440
 */
import type { AuditSnapshot, FindingDraft } from '../../types.js';
import { isMaterial, isQuantityDifferent } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

const LUMP_SUM_UNITS = new Set(['LS', 'LUMP', 'LOT']);

export function runRule007(snapshot: AuditSnapshot): FindingDraft[] {
  const { changeOrderLines, billingItems, settings } = snapshot;
  const findings: FindingDraft[] = [];

  for (const col of changeOrderLines) {
    // Skip lump-sum lines — RULE 007 does not apply
    if (col.rateType === 'lump_sum') continue;
    if (LUMP_SUM_UNITS.has(col.unit.toUpperCase())) continue;

    // Must have a non-zero approved quantity
    if (!col.quantity || col.quantity === 0) continue;

    // Find billing items linked to this CO with explicit quantity.
    // The billing CSV may not have change_order_line_number, so we match by:
    // 1. Billing item has same change_order_id as the CO
    // 2. Billing item has an explicit quantity (not null/zero)
    // 3. If billing has a change_order_line_number, it must match; otherwise, all qty billing for the CO
    // 4. Unit must be compatible (same unit or billing unit not specified)
    const linkedBilling = billingItems.filter(
      (b) =>
        b.changeOrderId === col.changeOrderId &&
        b.quantity !== null &&
        b.quantity !== undefined &&
        b.quantity > 0 &&
        // If billing specifies a line number, it must match the CO line
        (b.changeOrderLineNumber === null ||
          b.changeOrderLineNumber === undefined ||
          b.changeOrderLineNumber === col.lineNumber) &&
        // Unit compatibility: same unit or billing unit not specified
        (!b.unit || b.unit.toUpperCase() === col.unit.toUpperCase()),
    );

    if (linkedBilling.length === 0) continue; // No line-level billing for this line

    // Sum billed quantity across all linked billing items for this line
    const billedQty = linkedBilling.reduce((sum, b) => sum + (b.quantity ?? 0), 0);

    if (!isQuantityDifferent(col.quantity, billedQty, settings)) continue;

    const qtyDiff = col.quantity - billedQty; // positive = underbilled

    // Materiality on the monetary amount
    const monetaryDiff = Math.abs(qtyDiff) * col.approvedUnitPrice;
    if (!isMaterial(monetaryDiff, settings, col.approvedAmount)) continue;

    const amountSigned = qtyDiff * col.approvedUnitPrice;
    const amountAtRisk = Math.abs(amountSigned);
    const direction = amountSigned > 0 ? 'UNDERBILLED' : 'OVERBILLED';

    findings.push({
      rule: 'RULE_007',
      findingType: 'QUANTITY_MISMATCH',
      financialDirection: direction,
      severity: scoreSeverity(amountAtRisk, direction),
      confidence: 'HIGH',
      relatedRecords: [
        { type: 'change_order', id: col.changeOrderId },
        { type: 'change_order_line', id: `${col.changeOrderId}:${col.lineNumber}` },
        ...linkedBilling.map((b) => ({ type: 'billing_item', id: b.billingId })),
      ],
      relatedFindingRefs: [
        // May be related to RULE_002 on same CO
        `RULE_002:${col.changeOrderId}`,
      ],
      amountSigned,
      amountAtRisk,
      calculation:
        `ChangeOrderLine ${col.changeOrderId} line ${col.lineNumber}: ` +
        `${col.quantity} ${col.unit} × $${col.approvedUnitPrice.toFixed(2)} approved; ` +
        `billing ${billedQty} ${col.unit} × $${col.approvedUnitPrice.toFixed(2)}. ` +
        `Quantity difference: ${qtyDiff} ${col.unit} × $${col.approvedUnitPrice.toFixed(2)} = ` +
        `${amountSigned > 0 ? '+' : ''}$${amountSigned.toFixed(2)}.`,
      calculationJson: {
        rule: 'RULE_007',
        operands: {
          change_order_id: col.changeOrderId,
          line_number: col.lineNumber,
          approved_quantity: col.quantity,
          billed_quantity: billedQty,
          unit: col.unit,
          approved_unit_price: col.approvedUnitPrice,
          quantity_diff: qtyDiff,
          linked_billing_ids: linkedBilling.map((b) => b.billingId),
        },
        formula: 'amount_signed = (approved_qty - billed_qty) × approved_unit_price',
        result: amountSigned,
      },
      explanation:
        `CO ${col.changeOrderId} line ${col.lineNumber}: approved ${col.quantity} ${col.unit} ` +
        `billed ${billedQty} ${col.unit}, difference ${Math.abs(qtyDiff)} ${col.unit} ` +
        `× $${col.approvedUnitPrice.toFixed(2)} = $${amountAtRisk.toFixed(2)} ${direction.toLowerCase()}.`,
    });
  }

  return findings;
}
