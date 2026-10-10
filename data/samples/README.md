# Sample Data — Synthetic Commercial Electrical Fit-Out

**Label:** SYNTHETIC — FOR TESTING ONLY. Not real customer data.

## Project

- Name: Metro Office Tower — Electrical Fit-Out
- Type: Commercial electrical subcontract
- Original contract value: $1,250,000
- SOV revised total (as recorded): $1,270,000
- Net approved change orders: $161,000 → expected revised contract $1,411,000 (RULE 006 discrepancy intentionally seeded)
- Audit as-of date for ground truth: 2025-08-15

## Files

| File | Type | Notes |
|------|------|-------|
| contract_sov.csv | Contract / SOV | Base + revised line amounts |
| change_orders.csv | Change Order headers | Includes change_method, expected_bill_after |
| change_order_lines.csv | CO line items | Quantity / unit / rate for RULE 007 & 008 |
| rate_table.csv | Contractual rates | Overtime sell rate for RULE 008 |
| tm_tickets.csv | T&M Tickets | billable_status, billing_expected, billing_basis, labor_rate_type |
| billing.csv | Billing / Invoices | Multi-period, partial, rate mismatch, duplicate |
| evidence.csv | Supporting Evidence | Mixed strength |
| expected_findings.json | Ground truth | All findings are computable from the CSVs |

## Seeded Issues (Positive Tests) — all computable

1. CO-014 fully approved, $0 billed → RULE 001 UNDERBILLED
2. CO-007 approved $24,800, billed $18,500 → RULE 002 UNDERBILLED
3. CO-019 duplicate billing → RULE 002 OVERBILLED + RULE 009 (grouped)
4. TM-042 approved, **billable**, no CO, no billing → RULE 003
5. Contract value vs revised SOV → RULE 006
6. CO-003 line: 100 LF approved, 60 LF billed → RULE 007
7. CO-011 / RateTable: $127.50 vs billed $118.75 → RULE 008
8. CO-022 fixed_price evidence thin → RULE 010 EVIDENCE_RISK

## Negative Tests (Must NOT Flag)

- CO-005 multi-period progress billing (total = approved)
- CO-015 credit
- CO-002 submitted→approved negotiation ($500)
- All non_billable / internal T&M tickets
- Retainage-only differences
- Unlinked T&M with billable_status=unknown (no HIGH RULE 003)

See `expected_findings.json` for the authoritative list.
