/**
 * RULE 006 — Contract Value Reconciliation (revised)
 * Spec: docs/03-detection-rules.md § RULE 006
 *
 * Compare CONTRACT VALUE only:
 *   expected_revised_contract =
 *     original_contract_value
 *     + sum(approved CO amounts where status = approved)
 *     − sum(|approved credits|)
 *
 * vs. revised SOV total (sum of approved_revised_amount across all SOV lines).
 *
 * Flag if |expected_revised_contract − revised_SOV_total| ≥ materiality.
 *
 * DO NOT compare contract value to cumulative billing-to-date.
 *
 * Expected result for sample data:
 *   Original contract: $1,250,000 (sum of SOV original_amounts)
 *   Net approved COs: +$161,000 (sum of all approved CO amounts including CO-015 credit)
 *   Expected revised: $1,411,000
 *   SOV revised total: $1,270,000 (sum of approved_revised_amount)
 *   Discrepancy: $141,000
 */
import type { AuditSnapshot, FindingDraft } from '../../types.js';
import { isMaterial } from '../materiality.js';
import { scoreSeverity } from '../severity.js';

export function runRule006(snapshot: AuditSnapshot): FindingDraft[] {
  const { contractSovLines, changeOrders, settings } = snapshot;
  const findings: FindingDraft[] = [];

  if (contractSovLines.length === 0) return findings;

  // Original contract value = sum of SOV original_amounts
  const originalContractValue = contractSovLines.reduce(
    (sum, line) => sum + line.originalAmount,
    0,
  );

  // Revised SOV total = sum of SOV approved_revised_amounts
  const revisedSovTotal = contractSovLines.reduce(
    (sum, line) => sum + line.approvedRevisedAmount,
    0,
  );

  // Net approved COs (approved status only; credits are negative amounts)
  const approvedCos = changeOrders.filter((co) => co.status === 'approved');
  const netApprovedCoAmount = approvedCos.reduce(
    (sum, co) => sum + co.approvedAmount,
    0,
  );

  const expectedRevisedContract = originalContractValue + netApprovedCoAmount;
  const discrepancy = expectedRevisedContract - revisedSovTotal;

  if (!isMaterial(Math.abs(discrepancy), settings, Math.abs(expectedRevisedContract))) {
    return findings;
  }

  const amountAtRisk = Math.abs(discrepancy);

  findings.push({
    rule: 'RULE_006',
    findingType: 'REVENUE_RECONCILIATION',
    financialDirection: 'DATA_QUALITY',
    severity: scoreSeverity(amountAtRisk, 'DATA_QUALITY'),
    confidence: 'HIGH',
    relatedRecords: [
      ...contractSovLines.map((l) => ({ type: 'contract_sov', id: l.lineId })),
      ...approvedCos.map((co) => ({ type: 'change_order', id: co.changeOrderId })),
    ],
    relatedFindingRefs: [],
    amountSigned: null, // DATA_QUALITY: no signed revenue direction
    amountAtRisk,
    calculation:
      `Original contract $${originalContractValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} ` +
      `+ net approved COs $${netApprovedCoAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ` +
      `= expected revised $${expectedRevisedContract.toLocaleString('en-US', { minimumFractionDigits: 2 })}. ` +
      `SOV revised total = $${revisedSovTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}. ` +
      `Discrepancy ≈ $${discrepancy.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    calculationJson: {
      rule: 'RULE_006',
      operands: {
        original_contract_value: originalContractValue,
        net_approved_co_amount: netApprovedCoAmount,
        expected_revised_contract: expectedRevisedContract,
        revised_sov_total: revisedSovTotal,
        discrepancy,
        approved_co_ids: approvedCos.map((c) => c.changeOrderId),
      },
      formula:
        'discrepancy = (original_contract + net_approved_cos) - revised_sov_total',
      result: discrepancy,
    },
    explanation:
      `Contract value reconciliation: expected revised contract ` +
      `$${expectedRevisedContract.toFixed(2)} (original $${originalContractValue.toFixed(2)} ` +
      `+ net approved COs $${netApprovedCoAmount.toFixed(2)}) ` +
      `does not match SOV revised total $${revisedSovTotal.toFixed(2)}. ` +
      `Discrepancy of $${Math.abs(discrepancy).toFixed(2)} requires investigation. ` +
      `Note: this is a DATA_QUALITY finding — do not compare to billing-to-date.`,
  });

  return findings;
}
