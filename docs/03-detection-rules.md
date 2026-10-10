# 03 — Detection Rules

**Related:** [02-data-model.md](02-data-model.md) · [04-findings-taxonomy.md](04-findings-taxonomy.md) · [05-severity-scoring.md](05-severity-scoring.md) · [11-testing-strategy.md](11-testing-strategy.md)

## Principles

1. Rules are **deterministic**. Same inputs → same findings.
2. Every finding cites source record IDs, original values, normalized values, calculation, and confidence.
3. Rules use **materiality thresholds** (workspace-configurable). Differences below threshold produce no finding (or INFO-level only if configured).
4. AI is **not** allowed to invent amounts or override rule outcomes.
5. Language for uncertain cases must be cautious (e.g. “Potentially unbilled T&M work”).
6. **No financial inference** that invents quantities or rates not present in the data (e.g. do not derive quantity = amount / unit_price unless both quantity and unit_price are explicit on the same record family).
7. Every audit run has an explicit **`as_of_date`** (billing cutoff). Timing-based rules respect it.


## Rule Precedence & De-duplication

When multiple rules fire on the same economic event:

1. **More specific wins for primary classification:**
   - Quantity line mismatch → RULE 007 is primary; RULE 002 may be linked as related.
   - Rate/unit-price mismatch → RULE 008 is primary; RULE 002 may be linked as related.
   - Duplicate invoice → RULE 009 is primary; RULE 002 OVERBILLED is linked as related.
2. Store `related_finding_ids` on both findings.
3. Dashboard economic totals count the **grouped** amount once (use the more specific rule’s amount_signed).
4. RULE 002 still runs for pure header-level partial billing where no quantity/rate lines explain the variance (e.g. CO-007 lump-sum partial bill).

## Matching Algorithm (heart of the product)

Matching is a first-class concern. Results are stored in the `Match` entity.

| Level | Method | Confidence | Auto-findings? |
|-------|--------|------------|----------------|
| 1 | **Exact IDs** — CO number, ticket number, invoice reference | 1.0 | Yes |
| 2 | **Strong composite** — project + cost code + customer reference + line reference | 0.85–0.95 | Yes if ≥ 0.90 |
| 3 | **Structured attributes** — date window + amount ± tolerance + description tokens + quantity | 0.60–0.85 | Only MEDIUM/LOW confidence findings; prefer review |
| 4 | **Fuzzy / semantic (AI)** — candidate suggestions only | 0.30–0.70 | **Never** auto-generate HIGH-confidence financial findings |

- Fuzzy matches create *candidate* links for human confirmation, not automatic revenue findings.
- User-confirmed matches become Level 1 for subsequent runs.
- Matching service must expose `match_method`, `match_confidence`, `user_confirmed`.

---

## RULE 001 — Approved CO Not Billed

**Condition:**  
- CO status = approved  
- Sum of linked BillingItem.amount = 0 (or no matches)  
- |approved_amount| ≥ materiality  
- `as_of_date` ≥ (expected_bill_after OR approved_date + configurable grace, default 30 days)  
  *(if expected_bill_after is null, apply grace period from approved_date)*

**Financial direction:** UNDERBILLED  
**Finding type:** `REVENUE_AT_RISK`  
**amount_signed:** +approved_amount  

**Example language:**  
“Change Order CO-014 is approved at $24,800. No billing records are linked as of audit cutoff. Potential unbilled amount: $24,800.”

---

## RULE 002 — Approved CO Amount Variance (Partial / Over)

**Condition:**  
- CO status = approved  
- At least one linked billing record  
- |approved_amount − billed_amount| ≥ materiality  

**Financial direction:**  
- If approved − billed > 0 → UNDERBILLED  
- If approved − billed < 0 → OVERBILLED  

**Finding type:**  
- UNDERBILLED → `REVENUE_AT_RISK` or `REVENUE_RECONCILIATION`  
- OVERBILLED → `BILLING_MISMATCH` (and often co-occurs with RULE 009)

**amount_signed:** approved − billed (signed)

**Grouping / precedence:**  
- If RULE 007 or RULE 008 explains the same variance on the same CO, treat those as primary and link RULE 002 as related (do not double-count in dashboard).  
- If RULE 009 also fires, group with RULE 002 OVERBILLED so the economic issue is counted once.  
- RULE 002 is the **primary** finding when the CO is lump-sum / has no explanatory quantity or rate lines (e.g. CO-007 partial package billing).

**Example (under):**  
“Change Order CO-007 is approved at $24,800. Linked billing totals $18,500. Variance: +$6,300 (underbilled).”

**Example (over):**  
“Change Order CO-019 is approved at $11,200. Linked billing totals $22,400. Variance: −$11,200 (overbilled).”

---

## RULE 003 — Billable T&M with No Downstream Billing

**Condition:**  
- T&M `approval_status` = approved (or strong approval evidence)  
- `total_amount` ≥ materiality  
- `billable_status` = billable  
- `billing_expected` ∈ {true, unknown}  
- No matching ChangeOrder **and** no matching BillingItem (per Matching Algorithm)  
- `as_of_date` ≥ (expected_bill_after OR ticket.date + grace)

**Financial direction:** UNDERBILLED (cautious)  
**Finding type:** `REVENUE_AT_RISK` or `MISSING_LINK`  
**amount_signed:** +total_amount  

**Language must be cautious:**  
“Potentially unbilled T&M work (ticket marked billable, no linked CO or billing as of cutoff).”

**Explicit non-triggers:**  
- `billable_status` = non_billable  
- `billing_expected` = false  
- Internal work (cleanup, safety meeting, inventory, warranty callback when marked non-billable)

---

## RULE 004 — Billing References Nonexistent CO

**Condition:**  
Billing item contains a `change_order_id` that does not exist in the change-order dataset for the project.

**Financial direction:** DATA_QUALITY  
**Finding type:** `BILLING_MISMATCH` or `DATA_QUALITY`

---

## RULE 005 — CO Submitted vs Approved Variance (explanatory)

**Condition:**  
- |original_amount − approved_amount| ≥ materiality  
- Status is not cancelled/void  
- No later revision, credit, or documented negotiation that explains the difference

**Financial direction:** NONE or DATA_QUALITY (not automatic revenue loss)  
**Finding type:** `REVENUE_RECONCILIATION` (low priority) or informational

**Guardrail:** Customer negotiation (e.g. submitted $12,500 → approved $12,000) is normal. Prefer INFO / review unless unexplained after status transitions.

**MVP recommendation:** Implement as informational only, or postpone if it produces noise.

---

## RULE 006 — Contract Value Reconciliation (revised)

**Condition:**  
Compare **contract value** only:

```
expected_revised_contract =
  original_contract_value
  + sum(approved CO amounts where status = approved)
  − sum(|approved credits|)
```

against the **revised SOV total** (or declared revised contract value).

Flag if |expected_revised_contract − revised_SOV_total| ≥ materiality.

**Do NOT** compare contract value to cumulative billing-to-date. Billing progress is a separate, non-anomaly concept during an active project.

**Financial direction:** DATA_QUALITY or REVENUE_RECONCILIATION  
**Finding type:** `REVENUE_RECONCILIATION`

**Separate (optional later) billing-progress view:**  
billable amount as of cutoff vs billed amount as of cutoff — not an automatic anomaly.

---

## RULE 007 — Quantity Mismatch

**Condition:**  
- ChangeOrderLine exists with explicit `quantity` and `unit`  
- `unit` is **not** a lump-sum unit (`LS`, `LUMP`, `LOT`)  
- Linked BillingItem has explicit `quantity` and compatible `unit`  
- |approved_qty − billed_qty| ≥ materiality (absolute or % of approved)  

**Financial direction:** UNDERBILLED if billed_qty < approved_qty; OVERBILLED if billed_qty > approved_qty  
**Finding type:** `QUANTITY_MISMATCH`  
**amount_signed:** (approved_qty − billed_qty) × approved_unit_price  

**Forbidden:**  
- Inferring quantity = header_amount / unit_price when no line quantity exists.  
- Applying this rule to lump-sum lines (quantity is always 1 by definition; overbilling of LS packages is RULE 002 / RULE 009).

---

## RULE 008 — Unit-Price / Rate Mismatch

**Condition:**  
- Approved unit price exists on ChangeOrderLine **or** RateTable for the relevant rate_type  
- ChangeOrderLine `rate_type` is **not** `lump_sum` and unit is not lump-sum  
- Billed unit_price exists on BillingItem  
- |approved_unit_price − billed_unit_price| > rounding tolerance  

**Financial direction:** UNDERBILLED if billed rate < approved bill rate; OVERBILLED if billed > approved  
**Finding type:** `RATE_MISMATCH`  
**amount_signed:** (approved_unit_price − billed_unit_price) × billed_quantity  

**Rate model:** Use `rate_type` / `rate_basis` on CO lines and RateTable. Do not assume `labor_rate` on a T&M ticket is the contractual sell rate unless `labor_rate_type` = labor_bill or overtime_bill.

**Forbidden:** Treating a lump-sum package’s full amount as a “unit price” comparable across partial progress bills.

---

## RULE 009 — Duplicate Billing

**Condition:**  
Detect duplicate invoice / change / T&M combinations using:
- project
- same (or overlapping) billing period **or** same invoice intentionally re-issued
- reference / CO / ticket
- amount
- description similarity

**Must NOT fire when:**  
- Legitimate multi-period progress billing where `billed_to_date` increases consistently and sum of period amounts equals approved (e.g. CO-005: $7,500 + $7,500 with billed_to_date 7,500 → 15,000).  
- Credit / reversal invoices that net the original.

**Financial direction:** OVERBILLED  
**Finding type:** `DUPLICATE`  
**amount_signed:** −(duplicate amount)  

**Grouping:** Link to any RULE 002 OVERBILLED finding on the same CO.

---

## RULE 010 — Evidence Weakness (policy-aware)

**Condition:**  
Billed change (or billed T&M) that lacks **expected** supporting evidence according to `change_method` / evidence policy:

| change_method | Minimum expected evidence |
|---------------|---------------------------|
| t_and_m       | T&M ticket + approval + date + labor/material support |
| unit_price    | Quantity support + approval |
| fixed_price   | Approved CO + scope/authorization (T&M ticket **not** required) |
| allowance     | Approval + draw support |

Missing items that trigger: no ticket (when required), no approval, no supporting document, missing date, missing customer approval, missing linkage when expected.

**Financial direction:** EVIDENCE_RISK  
**Finding type:** `EVIDENCE_RISK`  
**amount_at_risk:** amount of the billed item (dispute exposure, not automatic lost revenue)

---

## Materiality & Configuration

- Default materiality: $100 absolute **or** 0.5% of the relevant line amount, whichever is higher.
- Configurable per workspace.
- Rounding tolerance for unit prices and quantities is also configurable (default: 0.01 for currency, 0.001 for quantity).
- Grace period for “expected billing” default: 30 days (configurable).

## False-Positive Guardrails

The following should **not** automatically produce findings (see [11-testing-strategy.md](11-testing-strategy.md)):

- Retainage differences
- Approved credits
- Billing timing differences (legitimate multi-period billing within grace / before expected_bill_after)
- Change orders intentionally billed over multiple periods
- Rounding
- Legitimate revised rates that are documented
- Cancelled / void change orders
- Partial-period billing that is consistent with progress
- Non-billable / internal T&M tickets
- Fixed-price COs without a T&M ticket (RULE 010)

Rules must be written and tested against these cases.
