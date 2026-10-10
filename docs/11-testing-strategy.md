# 11 — Testing Strategy

**Related:** [03-detection-rules.md](03-detection-rules.md) · [14-acceptance-criteria.md](14-acceptance-criteria.md) · [data/samples/](../data/samples/)

## Goals

1. Prove that intentionally inserted issues are detected.
2. Prove that legitimate differences are **not** incorrectly flagged (false-positive control).
3. Protect financial calculations from silent regression.
4. Verify tenant isolation and basic security properties.

## Test Pyramid

| Level | Focus |
|-------|-------|
| Unit | Individual rules, severity formula, parsers, normalizers |
| Integration | Import → normalize → match → rule engine → findings |
| End-to-end | Full user workflow on synthetic project |
| Data | Golden-file comparison against `expected_findings.json` |

## Synthetic Project Requirements

Create a commercial electrical fit-out project that includes at least:

- 20 change orders
- 50+ T&M tickets
- Multiple billing periods
- Several invoices / pay applications
- Contract / SOV
- Supporting evidence records

### Intentionally Inserted Issues

| Issue | Expected Rule |
|-------|---------------|
| One completely unbilled approved CO | RULE 001 |
| One partially billed CO | RULE 002 |
| One approved T&M ticket with no CO / billing | RULE 003 |
| One wrong billing rate | RULE 008 |
| One quantity mismatch | RULE 007 |
| One duplicate | RULE 009 |
| One weak-evidence item | RULE 010 |
| One legitimate difference that must **NOT** be flagged | (negative test) |

Ground truth lives in:

```
data/samples/expected_findings.json
```

## False-Positive Test Cases (Must Not Flag)

Document and automate tests for:

- Retainage differences
- Approved credits
- Billing timing differences (legitimate multi-period)
- Change orders intentionally billed over multiple periods
- Rounding differences within tolerance
- Legitimate revised rates (with supporting approval)
- Cancelled / void change orders
- Partial-period billing consistent with progress

## Required Automated Tests

- Every RULE 001–010 has positive and negative unit tests.
- Severity scoring formula has exhaustive band tests.
- Currency / date / number parsers handle edge cases listed in import tolerance table.
- Tenant isolation: user from Workspace A cannot read Project from Workspace B.
- Report generation produces expected columns / sections for the synthetic project.

## Manual / Exploratory

- Upload of real-looking messy spreadsheets.
- PDF text extraction quality on sample pay applications.
- UI review of finding explainability.

## CI Expectations

- Unit + integration tests run on every PR.
- E2E suite runs on main / nightly.
- Coverage of `rules/` and `normalize/` modules should be high (≥ 80% line coverage as a target).

## Acceptance Link

Passing the synthetic-project ground-truth test is a hard gate for technical MVP success. See [14-acceptance-criteria.md](14-acceptance-criteria.md).
