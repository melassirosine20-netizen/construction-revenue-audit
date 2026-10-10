/**
 * Materiality calculations — per docs/03-detection-rules.md § Materiality & Configuration
 * Default: $100 absolute OR 0.5% of the relevant line amount, whichever is higher.
 * Configurable per workspace — never hard-coded as a magic constant in rule logic.
 */
import type { WorkspaceSettings } from '../types.js';

/**
 * Returns true if |amount| exceeds the materiality threshold.
 * threshold = max(materialityAbsolute, materialityPct × referenceAmount)
 *
 * @param amount        - the difference to test (absolute value used internally)
 * @param settings      - workspace settings
 * @param referenceAmount - the "relevant line amount" (e.g. approved_amount) for pct calculation;
 *                          defaults to |amount| if omitted
 */
export function isMaterial(
  amount: number,
  settings: WorkspaceSettings,
  referenceAmount?: number,
): boolean {
  const abs = Math.abs(amount);
  const ref = referenceAmount !== undefined ? Math.abs(referenceAmount) : abs;
  const threshold = Math.max(
    settings.materialityAbsolute,
    settings.materialityPct * ref,
  );
  return abs >= threshold;
}

/**
 * Returns true if |qty difference| exceeds rounding tolerance.
 */
export function isQuantityDifferent(
  approvedQty: number,
  billedQty: number,
  settings: WorkspaceSettings,
): boolean {
  return Math.abs(approvedQty - billedQty) > settings.roundingQuantity;
}

/**
 * Returns true if |price difference| exceeds rounding tolerance.
 */
export function isPriceDifferent(
  approvedPrice: number,
  billedPrice: number,
  settings: WorkspaceSettings,
): boolean {
  return Math.abs(approvedPrice - billedPrice) > settings.roundingCurrency;
}
