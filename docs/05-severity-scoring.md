# 05 — Severity Scoring

**Related:** [04-findings-taxonomy.md](04-findings-taxonomy.md) · [03-detection-rules.md](03-detection-rules.md)

## Design Goals (MVP-simplified)

- Transparent and deterministic.
- Driven primarily by **financial impact** and **confidence**.
- Age is shown as metadata (`days_outstanding`) but does **not** automatically inflate severity (old issues may already be resolved, deferred, or trapped in retainage).
- Avoid double-counting correlated factors (confidence and evidence quality).

## Severity Levels

| Level | Meaning |
|-------|---------|
| CRITICAL | Large, high-confidence financial exposure |
| HIGH | Significant exposure or strong evidence of mismatch |
| MEDIUM | Moderate exposure or mixed confidence |
| LOW | Small exposure or low confidence |
| INFO | Data-quality or informational items with negligible financial impact |

## Scoring Inputs (MVP)

| Factor | Weight | Values |
|--------|--------|--------|
| Financial amount (A) | 50% | Normalized 0–100 based on amount bands |
| Confidence (C) | 35% | HIGH=100, MEDIUM=60, LOW=25 |
| Actionability (X) | 15% | Actionable now=100, Needs more data=50, Likely timing/retainage=20 |

### Amount Bands (configurable)

| Amount at risk (absolute) | Score (A) |
|---------------------------|-----------|
| < $500                    | 10 |
| $500 – $2,000             | 30 |
| $2,001 – $10,000          | 55 |
| $10,001 – $50,000         | 80 |
| > $50,000                 | 100 |

### Confidence Mapping

| Confidence | Score (C) |
|------------|-----------|
| HIGH       | 100 |
| MEDIUM     | 60 |
| LOW        | 25 |

### Actionability

| Situation | Score (X) |
|-----------|-----------|
| Clear under/over billing with exact match | 100 |
| Evidence incomplete but policy requires it | 70 |
| Needs human confirmation of match | 50 |
| Likely legitimate timing / retainage / grace period | 20 |

## Composite Score

```
score = 0.50 * A + 0.35 * C + 0.15 * X
```

## Severity Mapping

| Score range | Severity |
|-------------|----------|
| ≥ 80        | CRITICAL |
| 60 – 79     | HIGH |
| 40 – 59     | MEDIUM |
| 20 – 39     | LOW |
| < 20        | INFO |

## Special Cases

- `DATA_QUALITY` findings with zero amount default to INFO or LOW.
- `EVIDENCE_RISK` findings use the related billed amount for A, but severity is capped at HIGH unless confidence is also HIGH.
- Findings below materiality threshold are not created (or INFO only if workspace setting enables it).
- Display `days_outstanding` next to the finding; do not bake age into the score for MVP.

## Implementation Notes

- Implement the formula in a single, well-tested module.
- Workspace can override amount bands and weights (advanced settings).
- Every finding stores the computed score and the factor breakdown for transparency.
