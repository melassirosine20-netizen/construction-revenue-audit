# 02 — Data Model

**Related:** [schemas/](../schemas/) · [03-detection-rules.md](03-detection-rules.md) · [06-import-workflow.md](06-import-workflow.md) · [09-security.md](09-security.md)

## Core Principles

1. **Provenance first.** Never overwrite the original imported value. Store `raw_value` + `normalized_value` + source references.
2. **Tenant isolation.** Every record belongs to a workspace. Never expose one customer’s data to another.
3. **Auditability.** Audit-run results and review actions are immutable historical records. A Finding has a mutable *current_status* and an append-only `FindingEvent` history.
4. **Separation of raw vs normalized.** Extraction produces raw records; normalization produces structured, validated records used by the rule engine.
5. **Line-item economics where needed.** Change orders and billing support line items (quantity / unit / rate) so quantity and rate rules are computable without inference.
6. **Explicit billability.** T&M tickets declare whether they are expected to become revenue.
7. **Audit cutoff.** Every audit run has an explicit `as_of_date` / billing cutoff so “not yet billed” is distinguishable from “past due and unbilled.”

## Entity Overview

```
Workspace
  └── User (membership)
  └── Project
        └── Document (uploaded file)
        └── Import (parse job)
              └── RawRecord
              └── NormalizedRecord
        └── Contract / SOV Line
        └── ChangeOrder
              └── ChangeOrderLine
        └── TMTicket
        └── BillingItem (invoice line)
        └── Evidence
        └── EvidenceLink (many-to-many)
        └── Match (record matching result)
        └── RateTable (optional contractual rates)
        └── AuditRun
              └── Finding
                    └── FindingEvent
                    └── FindingEvidence
```

## Entity Definitions

### Workspace

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| name | string | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### User

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| email | string | unique |
| name | string | |
| password_hash | string | or auth-provider ID |
| created_at | timestamptz | |

### WorkspaceMembership

| Field | Type | Notes |
|-------|------|-------|
| workspace_id | UUID | FK |
| user_id | UUID | FK |
| role | enum | owner, admin, member, viewer |
| created_at | timestamptz | |

### Project

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| workspace_id | UUID | FK, indexed |
| name | string | |
| external_project_number | string | optional |
| status | enum | active, archived |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Document

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| project_id | UUID | FK |
| workspace_id | UUID | FK (denormalized for isolation) |
| filename | string | |
| storage_key | string | S3/object storage path |
| content_type | string | |
| size_bytes | integer | |
| document_type | enum | contract_sov, change_order, tm_ticket, billing, evidence, unknown |
| uploaded_by | UUID | FK user |
| created_at | timestamptz | |

### Import

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| project_id | UUID | FK |
| document_id | UUID | FK |
| status | enum | pending, parsing, mapping, validating, imported, failed |
| column_mapping | jsonb | user-confirmed mapping |
| row_count | integer | |
| error_count | integer | |
| warnings | jsonb | data-quality warnings |
| created_at | timestamptz | |
| completed_at | timestamptz | nullable |

### RawRecord

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| import_id | UUID | FK |
| project_id | UUID | FK |
| source_row | integer | or page for PDF |
| raw_payload | jsonb | original extracted row/object |
| created_at | timestamptz | |

### Normalized Entities — Common Provenance

All normalized entities share:

| Common Field | Type | Notes |
|--------------|------|-------|
| id | UUID | PK |
| project_id | UUID | FK |
| workspace_id | UUID | FK |
| source_document_id | UUID | FK Document |
| source_import_id | UUID | FK Import |
| source_row_or_page | string | |
| raw_values | jsonb | original values before normalization |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

#### Contract / SOV Line

| Field | Type | Notes |
|-------|------|-------|
| contract_id | string | business key |
| line_id | string | |
| cost_code | string | |
| description | text | |
| original_amount | decimal | |
| approved_revised_amount | decimal | |
| quantity | decimal | nullable |
| unit | string | nullable |
| unit_price | decimal | nullable |
| retainage | decimal | nullable |
| source_reference | string | |

---

#### Change Order (header)

| Field | Type | Notes |
|-------|------|-------|
| change_order_id | string | business key (e.g. CO-014) |
| title | string | |
| description | text | |
| status | enum | submitted, approved, rejected, cancelled, void |
| change_method | enum | fixed_price, t_and_m, unit_price, allowance, unknown |
| submitted_date | date | nullable |
| approved_date | date | nullable |
| effective_date | date | nullable |
| original_amount | decimal | submitted total |
| approved_amount | decimal | approved total (must equal sum of lines when lines exist) |
| billed_amount | decimal | **derived** from linked BillingItems |
| remaining_unbilled_amount | decimal | **derived** = approved − billed (signed) |
| customer_reference | string | |
| cost_code | string | primary / default |
| expected_bill_after | date | nullable — earliest date billing is expected |
| source_reference | string | |

#### Change Order Line (required for quantity / unit-price rules)

| Field | Type | Notes |
|-------|------|-------|
| change_order_id | string | FK to header |
| line_number | integer | |
| description | text | |
| cost_code | string | nullable |
| quantity | decimal | approved quantity |
| unit | string | LF, HR, EA, LS, etc. |
| approved_unit_price | decimal | |
| approved_amount | decimal | quantity × unit_price (or lump) |
| rate_type | enum | labor_bill, overtime_bill, material_markup, equipment_bill, unit_sell, lump_sum, unknown |
| rate_basis | enum | hourly, percentage, unit, lump_sum |

When lines exist, RULE 007 / RULE 008 operate on lines, not the header total alone.

---

#### T&M Ticket

| Field | Type | Notes |
|-------|------|-------|
| ticket_id | string | business key |
| date | date | |
| description | text | |
| worker_or_category | string | |
| labor_hours | decimal | |
| labor_rate | decimal | |
| labor_rate_type | enum | labor_cost, labor_bill, overtime_bill, unknown |
| labor_amount | decimal | |
| material_amount | decimal | |
| equipment_amount | decimal | |
| total_amount | decimal | |
| approval_status | enum | pending, approved, rejected |
| customer_signature | boolean | |
| **billable_status** | enum | **billable, non_billable, unknown** |
| **billing_expected** | enum | **true, false, unknown** |
| **billing_basis** | enum | **change_order, contract, t_and_m, unknown** |
| linked_change_order_id | string | nullable |
| expected_bill_after | date | nullable |
| source_reference | string | |

**Critical:** RULE 003 only fires when `billable_status = billable` **and** `billing_expected = true` (or unknown with high caution). Internal work (cleanup, safety meetings, inventory, warranty callbacks marked non-billable) must not generate revenue findings.

---

#### Billing Item (invoice / pay-app line)

| Field | Type | Notes |
|-------|------|-------|
| billing_id | string | business key (invoice / pay app) |
| billing_period | string | e.g. 2025-03 |
| invoice_number | string | |
| line_id | string | **always string** (normalize CSV numbers to string) |
| description | text | |
| cost_code | string | |
| change_order_id | string | nullable |
| change_order_line_number | integer | nullable — preferred when CO lines exist |
| amount | decimal | |
| quantity | decimal | nullable |
| unit_price | decimal | nullable |
| unit | string | nullable |
| retainage | decimal | nullable |
| billed_to_date | decimal | nullable |
| billing_date | date | nullable |
| source_reference | string | |

---

#### Evidence + EvidenceLink (many-to-many)

**Evidence**

| Field | Type | Notes |
|-------|------|-------|
| evidence_id | string | |
| date | date | nullable |
| type | enum | ticket, approval, photo, email, signature, daily_report, other |
| description | text | |
| file_reference | string | |
| page_reference | string | **string** (normalize numeric CSV values) |
| timestamp | timestamptz | nullable |
| confidence | enum | high, medium, low |

**EvidenceLink**

| Field | Type | Notes |
|-------|------|-------|
| evidence_id | string | FK |
| entity_type | enum | tm_ticket, change_order, billing_item, contract_sov |
| entity_id | string | business key |
| relationship | enum | supports, approves, references, attached_to |
| confidence | enum | high, medium, low |

One evidence item can support multiple entities; one entity can have many evidence items.

---

#### Match (record matching result)

| Field | Type | Notes |
|-------|------|-------|
| match_id | UUID | PK |
| project_id | UUID | |
| source_type | string | e.g. tm_ticket |
| source_id | string | |
| target_type | string | e.g. change_order |
| target_id | string | |
| match_method | enum | exact_id, strong_composite, structured_attributes, fuzzy_semantic, user_confirmed |
| match_confidence | decimal | 0–1 |
| user_confirmed | boolean | default false |
| created_at | timestamptz | |

See [03-detection-rules.md](03-detection-rules.md) § Matching Algorithm for the hierarchy.

---

#### Rate Table (optional, for contractual rates)

| Field | Type | Notes |
|-------|------|-------|
| project_id | UUID | |
| rate_id | string | |
| rate_type | enum | labor_bill, overtime_bill, material_markup, equipment_bill, unit_sell |
| rate_basis | enum | hourly, percentage, unit, lump_sum |
| amount | decimal | |
| effective_from | date | |
| effective_to | date | nullable |
| description | string | |

Used by RULE 008 when a contractual rate exists.

---

### Finding

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| project_id | UUID | FK |
| workspace_id | UUID | FK |
| audit_run_id | UUID | FK |
| finding_type | enum | see taxonomy |
| **financial_direction** | enum | **UNDERBILLED, OVERBILLED, EVIDENCE_RISK, DATA_QUALITY, NONE** |
| severity | enum | critical, high, medium, low, info |
| **current_status** | enum | open, reviewed, accepted, dismissed, resolved |
| related_record_ids | jsonb | array of {type, id} |
| **amount_signed** | decimal | nullable — positive = underbilled, negative = overbilled |
| amount_at_risk | decimal | absolute value used for display / severity bands |
| calculation | text | human-readable |
| calculation_json | jsonb | structured operands |
| explanation | text | |
| confidence | enum | high, medium, low |
| **related_finding_ids** | jsonb | for grouping (e.g. duplicate + overbilling of same CO) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### FindingEvent (immutable history)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| finding_id | UUID | FK |
| event_type | enum | created, reviewed, accepted, dismissed, resolved, recalculated, commented |
| user_id | UUID | nullable |
| note | text | |
| previous_status | string | nullable |
| new_status | string | nullable |
| created_at | timestamptz | |

### FindingEvidence

| Field | Type | Notes |
|-------|------|-------|
| finding_id | UUID | FK |
| evidence_id | string | |
| role | string | e.g. primary, supporting |

### AuditRun

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| project_id | UUID | FK |
| triggered_by | UUID | user or system |
| status | enum | running, completed, failed |
| rules_version | string | |
| **as_of_date** | date | **audit cutoff / billing cutoff** |
| started_at | timestamptz | |
| completed_at | timestamptz | nullable |
| summary | jsonb | counts by type / severity / financial_direction |

### ReviewAction (legacy convenience view; prefer FindingEvent)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| finding_id | UUID | FK |
| user_id | UUID | FK |
| action | enum | accept, dismiss, reassign, comment |
| note | text | |
| created_at | timestamptz | |

## Materiality Threshold

Configurable per workspace (default: $100 absolute **or** 0.5% of the relevant line amount, whichever is higher). Documented in configuration; never hard-coded as a magic number in rule logic.

## Amount Accounting (Dashboard)

Never dump all findings into a single “Potential Revenue Exposure” number. Report separately:

| Bucket | Meaning |
|--------|---------|
| Potential Underbilling | Sum of positive `amount_signed` where direction = UNDERBILLED |
| Potential Overbilling / Billing Correction | Absolute value of negative `amount_signed` where direction = OVERBILLED |
| Evidence / Dispute Exposure | Amounts on EVIDENCE_RISK findings |
| Data Quality Issues | Count (and optional $ if linked) of DATA_QUALITY findings |

Related findings (e.g. RULE 002 overbilling + RULE 009 duplicate of the same CO) must be **grouped** so the same economic issue is not double-counted in dashboard totals.

## JSON Schemas

Machine-readable schemas live in `/schemas/`. See that directory for the authoritative field definitions used by validation (Zod / JSON Schema).
