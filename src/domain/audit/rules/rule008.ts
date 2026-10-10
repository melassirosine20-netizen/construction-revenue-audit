/**
 * RULE 008 — Unit-Price / Rate Mismatch
 * Spec: docs/03-detection-rules.md § RULE 008
 *
 * Condition:
 *  - Approved unit price exists on ChangeOrderLine OR RateTable for the relevant rate_type
 *  - ChangeOrderLine rate_type is NOT lump_sum and unit is not lump-sum
 *  - Billed unit_price exists on BillingItem
 *  - |approved_unit_price − billed_unit_price| > rounding tolerance
 *
 * amount_signed = (approved_unit_price − billed_unit_price) × billed_quantity
 *
 * FORBIDDEN:
 *  - Treating lump-sum package's full amount as a "unit price"
 *  - Assuming labor_rate on T&M ticket is contractual sell rate unless labor_rate_type = labor_bill/overtime_bill
 *
 * Expected:
 *   CO-011 line 1: overtime_bill $127.50 approved; billing $118.75 × 80 HR = $700 underbilling
 */
import type { AuditSnapshot, FindingDraft, RateTableEntry } from '../../types.js';
import { isMaterial, isPriceDifferent } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

const LUMP_SUM_UNITS = new Set(['LS', 'LUMP', 'LOT']);

export function runRule008(snapshot: AuditSnapshot): FindingDraft[] {
  const { changeOrderLines, billingItems, rateTables, settings } = snapshot;
  const findings: FindingDraft[] = [];

  for (const col of changeOrderLines) {
    // Skip lump-sum lines — RULE 008 forbidden on lump-sum
    if (col.rateType === 'lump_sum') continue;
    if (LUMP_SUM_UNITS.has(col.unit.toUpperCase())) continue;

    // Find linked billing items with explicit unit_price
    const linkedBilling = billingItems.filter(
      (b) =>
        b.changeOrderId === col.changeOrderId &&
        (b.changeOrderLineNumber === null ||
          b.changeOrderLineNumber === undefined ||
          b.changeOrderLineNumber === col.lineNumber) &&
        b.unitPrice !== null &&
        b.unitPrice !== undefined &&
        b.quantity !== null &&
        b.quantity !== undefined &&
        b.quantity > 0,
    );

    if (linkedBilling.length === 0) continue;

    // Determine approved rate:
    // 1. Use ChangeOrderLine.approvedUnitPrice if it exists (non-zero, non-lump)
    // 2. Fall back to RateTable entry matching rate_type
    let approvedUnitPrice = col.approvedUnitPrice;
    let rateSource = `CO line ${col.changeOrderId}:${col.lineNumber}`;

    if (!approvedUnitPrice || approvedUnitPrice === 0) {
      const rateEntry = findRateTableEntry(rateTables, col.rateType, snapshot.asOfDate);
      if (!rateEntry) continue;
      approvedUnitPrice = rateEntry.amount;
      rateSource = `RateTable ${rateEntry.rateId}`;
    }

    for (const billing of linkedBilling) {
      const billedUnitPrice = billing.unitPrice!;
      const billedQty = billing.quantity!;

      if (!isPriceDifferent(approvedUnitPrice, billedUnitPrice, settings)) continue;

      const priceDiff = approvedUnitPrice - billedUnitPrice;
      const amountSigned = priceDiff * billedQty;
      const amountAtRisk = Math.abs(amountSigned);

      if (!isMaterial(amountAtRisk, settings, col.approvedAmount)) continue;

      const direction = amountSigned > 0 ? 'UNDERBILLED' : 'OVERBILLED';

      findings.push({
        rule: 'RULE_008',
        findingType: 'RATE_MISMATCH',
        financialDirection: direction,
        severity: scoreSeverity(amountAtRisk, direction),
        confidence: 'HIGH',
        relatedRecords: [
          { type: 'change_order', id: col.changeOrderId },
          { type: 'change_order_line', id: `${col.changeOrderId}:${col.lineNumber}` },
          { type: 'billing_item', id: billing.billingId },
        ],
        relatedFindingRefs: [
          `RULE_002:${col.changeOrderId}`,
        ],
        amountSigned,
        amountAtRisk,
        calculation:
          `CO line ${col.changeOrderId}:${col.lineNumber} (${rateSource}): ` +
          `approved rate $${approvedUnitPrice.toFixed(2)}/${col.unit} ` +
          `vs billed $${billedUnitPrice.toFixed(2)}/${col.unit} × ${billedQty} ${col.unit} ` +
          `= $${amountSigned > 0 ? '+' : ''}${amountSigned.toFixed(2)}.`,
        calculationJson: {
          rule: 'RULE_008',
          operands: {
            change_order_id: col.changeOrderId,
            line_number: col.lineNumber,
            approved_unit_price: approvedUnitPrice,
            billed_unit_price: billedUnitPrice,
            billed_quantity: billedQty,
            unit: col.unit,
            rate_type: col.rateType,
            rate_source: rateSource,
            billing_id: billing.billingId,
          },
          formula:
            'amount_signed = (approved_unit_price - billed_unit_price) × billed_quantity',
          result: amountSigned,
        },
        explanation:
          `CO ${col.changeOrderId} line ${col.lineNumber}: approved rate $${approvedUnitPrice.toFixed(2)} ` +
          `(${col.rateType}), billed $${billedUnitPrice.toFixed(2)} × ${billedQty} ${col.unit}. ` +
          `Rate discrepancy of $${Math.abs(priceDiff).toFixed(2)}/${col.unit} × ` +
          `${billedQty} ${col.unit} = $${amountAtRisk.toFixed(2)} ${direction.toLowerCase()}.`,
      });
    }
  }

  return findings;
}

function findRateTableEntry(
  rateTables: RateTableEntry[],
  rateType: string,
  asOfDate: string,
): RateTableEntry | null {
  const asOf = new Date(asOfDate + 'T00:00:00Z');
  for (const rt of rateTables) {
    if (rt.rateType !== rateType) continue;
    const from = new Date(rt.effectiveFrom + 'T00:00:00Z');
    const to = rt.effectiveTo ? new Date(rt.effectiveTo + 'T00:00:00Z') : null;
    if (asOf < from) continue;
    if (to && asOf > to) continue;
    return rt;
  }
  return null;
}
