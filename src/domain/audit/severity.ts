/**
 * Severity scoring — per docs/05-severity-scoring.md
 * Spec version: 1.0.0 — FROZEN
 */
import type { FindingSeverity, FinancialDirection } from '../types.js';

/**
 * Score a finding based on amount_at_risk and financial direction.
 *
 * From docs/05-severity-scoring.md (band-based):
 * CRITICAL : amount_at_risk ≥ $50,000
 * HIGH     : $10,000 ≤ amount_at_risk < $50,000
 * MEDIUM   : $1,000 ≤ amount_at_risk < $10,000
 * LOW      : $100 ≤ amount_at_risk < $1,000
 * INFO     : < $100  (below materiality; not usually surfaced)
 *
 * EVIDENCE_RISK and DATA_QUALITY findings default to MEDIUM unless amount_at_risk is larger.
 */
export function scoreSeverity(
  amountAtRisk: number,
  direction: FinancialDirection,
): FindingSeverity {
  const abs = Math.abs(amountAtRisk);

  // Evidence / data quality typically medium unless large
  if (direction === 'EVIDENCE_RISK' || direction === 'DATA_QUALITY') {
    if (abs >= 50_000) return 'HIGH';
    if (abs >= 10_000) return 'MEDIUM';
    return 'MEDIUM'; // floor for these types
  }

  if (abs >= 50_000) return 'CRITICAL';
  if (abs >= 10_000) return 'HIGH';
  if (abs >= 1_000) return 'MEDIUM';
  if (abs >= 100) return 'LOW';
  return 'INFO';
}
