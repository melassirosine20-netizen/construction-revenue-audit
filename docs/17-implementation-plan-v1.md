# 17 — Implementation Plan v1.0

**Spec version:** 1.0.0 (frozen)  
**Related:** [00-SPEC-VERSION.md](00-SPEC-VERSION.md) · [02-data-model.md](02-data-model.md) · [03-detection-rules.md](03-detection-rules.md) · [data/samples/expected_findings.json](../data/samples/expected_findings.json)

This plan is derived **only** from the approved specification. No new rules, fields, or workflows.

---

## A. Final Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Web UI (Next.js or equivalent)                             │
│  Upload · Column map · Projects · Findings list/detail · CSV│
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / JSON API
┌───────────────────────────▼─────────────────────────────────┐
│  API layer (route handlers / REST)                          │
│  Auth · Workspace scope · Import · Audit · Findings · Export│
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Domain services                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────┐ │
│  │ ImportService│ │ MatchService │ │ AuditEngine         │ │
│  │ parse/map/   │ │ L1–L3 exact/ │ │ RULE 001–010        │ │
│  │ normalize    │ │ composite/   │ │ materiality · grace │ │
│  └──────────────┘ │ structured   │ │ signed amounts      │ │
│                   └──────────────┘ └─────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐                         │
│  │ Severity     │ │ FindingsSvc  │                         │
│  │ scorer       │ │ group · CRUD │                         │
│  └──────────────┘ └──────────────┘                         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Persistence (Postgres + object storage for uploaded files) │
│  Workspace · Project · Document · Import · RawRecord        │
│  ContractSOV · ChangeOrder · ChangeOrderLine · TMTicket     │
│  BillingItem · RateTable · Match · AuditRun · Finding       │
│  FindingEvent · Evidence · EvidenceLink                     │
└─────────────────────────────────────────────────────────────┘
```

**Non-negotiable separation**

1. Extraction / import  
2. Normalization  
3. Deterministic financial rules (AuditEngine)  
4. Evidence linking  
5. AI interpretation — **deferred; not in v1.0 critical path**

The AuditEngine must be a pure module: given normalized records + `as_of_date` → findings. Runnable from unit tests with zero UI.

**Suggested stack (boring defaults; swap only if already standardized in the monorepo)**

- Runtime: Node.js + TypeScript  
- API/UI: Next.js (App Router) or separate API + simple React  
- DB: PostgreSQL  
- Validation: Zod aligned to `schemas/*.json`  
- Auth: session-based (Auth.js / equivalent)  
- Object storage: S3-compatible (or local disk in dev)  
- Tests: Vitest or Jest for unit; Playwright optional later for UI  

Stack choices are implementation detail; the module boundaries are not.

---

## B. Database Schema

All monetary amounts: `NUMERIC(18,2)` (or equivalent). Dates: `DATE`. Timestamps: `TIMESTAMPTZ`. IDs: UUID unless business key is string.

### Tenancy & auth

```
workspaces (id, name, created_at, updated_at)
users (id, email UNIQUE, name, password_hash, created_at)
workspace_memberships (workspace_id, user_id, role, created_at)
  role ∈ {owner, admin, member, viewer}
```

### Projects & documents

```
projects (id, workspace_id, name, external_project_number, status, created_at, updated_at)
  status ∈ {active, archived}

documents (id, project_id, workspace_id, filename, storage_key, content_type,
           size_bytes, document_type, uploaded_by, created_at)
  document_type ∈ {contract_sov, change_order, tm_ticket, billing, evidence, unknown}

imports (id, project_id, document_id, status, column_mapping JSONB,
         row_count, error_count, warnings JSONB, created_at, completed_at)
  status ∈ {pending, parsing, mapping, validating, imported, failed}

raw_records (id, import_id, project_id, source_row, raw_payload JSONB, created_at)
```

### Normalized financial entities  
*(common provenance columns on each: id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page, raw_values JSONB, created_at, updated_at)*

```
contract_sov_lines (
  …provenance,
  contract_id, line_id, cost_code, description,
  original_amount, approved_revised_amount,
  quantity, unit, unit_price, retainage, source_reference
)

change_orders (
  …provenance,
  change_order_id, title, description, status, change_method,
  submitted_date, approved_date, effective_date,
  original_amount, approved_amount,
  customer_reference, cost_code, expected_bill_after, source_reference
)
  status ∈ {submitted, approved, rejected, cancelled, void}
  change_method ∈ {fixed_price, t_and_m, unit_price, allowance, unknown}

change_order_lines (
  …provenance,
  change_order_id, line_number, description, cost_code,
  quantity, unit, approved_unit_price, approved_amount,
  rate_type, rate_basis
)
  rate_type ∈ {labor_bill, overtime_bill, material_markup, equipment_bill, unit_sell, lump_sum, unknown}
  rate_basis ∈ {hourly, percentage, unit, lump_sum}

tm_tickets (
  …provenance,
  ticket_id, date, description, worker_or_category,
  labor_hours, labor_rate, labor_rate_type, labor_amount,
  material_amount, equipment_amount, total_amount,
  approval_status, customer_signature,
  billable_status, billing_expected, billing_basis,
  linked_change_order_id, expected_bill_after, source_reference
)
  approval_status ∈ {pending, approved, rejected}
  labor_rate_type ∈ {labor_cost, labor_bill, overtime_bill, unknown}
  billable_status ∈ {billable, non_billable, unknown}
  billing_expected ∈ {true, false, unknown}   -- store as text/enum per schema
  billing_basis ∈ {change_order, contract, t_and_m, unknown}

billing_items (
  …provenance,
  billing_id, billing_period, invoice_number, line_id,
  description, cost_code, change_order_id, change_order_line_number,
  amount, quantity, unit_price, unit, retainage,
  billed_to_date, billing_date, source_reference
)

rate_table (
  …provenance,
  rate_id, rate_type, rate_basis, amount,
  effective_from, effective_to, description
)
```

### Matching, evidence, audit

```
matches (
  id, project_id, workspace_id,
  source_type, source_id, target_type, target_id,
  match_method, match_confidence, user_confirmed, created_at
)
  match_method ∈ {exact_id, strong_composite, structured_attributes, fuzzy_semantic, user_confirmed}

evidence (
  id, project_id, workspace_id, evidence_id, date, type, description,
  file_reference, page_reference, timestamp, confidence, …provenance
)
  type ∈ {ticket, approval, photo, email, signature, daily_report, other}

evidence_links (
  id, evidence_id, entity_type, entity_id, relationship, confidence
)
  entity_type ∈ {tm_ticket, change_order, billing_item, contract_sov}
  relationship ∈ {supports, approves, references, attached_to}

audit_runs (
  id, project_id, workspace_id, triggered_by, status, rules_version,
  as_of_date, started_at, completed_at, summary JSONB
)
  status ∈ {running, completed, failed}

findings (
  id, project_id, workspace_id, audit_run_id,
  finding_type, financial_direction, severity, current_status,
  related_records JSONB, related_finding_ids JSONB,
  amount_signed, amount_at_risk,
  calculation, calculation_json JSONB, explanation, confidence,
  created_at, updated_at
)
  finding_type ∈ {REVENUE_AT_RISK, REVENUE_RECONCILIATION, BILLING_MISMATCH,
                  RATE_MISMATCH, QUANTITY_MISMATCH, DUPLICATE, EVIDENCE_RISK,
                  MISSING_LINK, DATA_QUALITY}
  financial_direction ∈ {UNDERBILLED, OVERBILLED, EVIDENCE_RISK, DATA_QUALITY, NONE}
  severity ∈ {CRITICAL, HIGH, MEDIUM, LOW, INFO}
  current_status ∈ {OPEN, REVIEWED, ACCEPTED, DISMISSED, RESOLVED}
  confidence ∈ {HIGH, MEDIUM, LOW}

finding_events (
  id, finding_id, event_type, user_id, note,
  previous_status, new_status, created_at
)
  event_type ∈ {created, reviewed, accepted, dismissed, resolved, recalculated, commented}

finding_evidence (
  finding_id, evidence_id, role
)
```

### Workspace config (defaults only for v1.0)

```
workspace_settings (
  workspace_id PK,
  materiality_absolute NUMERIC DEFAULT 100,
  materiality_pct NUMERIC DEFAULT 0.005,
  rounding_currency NUMERIC DEFAULT 0.01,
  rounding_quantity NUMERIC DEFAULT 0.001,
  billing_grace_days INT DEFAULT 30
)
```

**Indexes:** workspace_id + project_id on all tenant tables; business keys `(project_id, change_order_id)`, `(project_id, ticket_id)`, etc.

---

## C. API / Module Structure

```
src/
  domain/
    audit/
      engine.ts          # pure: records + as_of → FindingDraft[]
      rules/
        rule001.ts … rule010.ts
      matching.ts        # L1–L3
      severity.ts
      grouping.ts        # related_finding_ids / dashboard buckets
      materiality.ts
    import/
      parseCsv.ts
      mapColumns.ts
      normalize.ts       # Zod + coercion
    findings/
      service.ts         # persist, status transitions, events
  db/
    schema.ts            # Drizzle/Prisma/SQL migrations
    repos/
  api/                   # or app/api/
    auth/
    workspaces/
    projects/
    imports/
    audit-runs/
    findings/
    export/
  ui/                    # or app/(routes)/
    projects/
    imports/
    findings/
  tests/
    audit/               # pure engine tests — no DB/UI required
    fixtures/            # load data/samples
```

### Core API endpoints (v1.0)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/...` | Login / session (provider-specific) |
| CRUD | `/api/workspaces`, `/api/projects` | Scoped to membership |
| POST | `/api/projects/:id/documents` | Upload CSV |
| POST | `/api/imports/:id/mapping` | Save column mapping |
| POST | `/api/imports/:id/commit` | Normalize + persist entities |
| POST | `/api/projects/:id/audit-runs` | Body: `{ as_of_date }` → run engine |
| GET | `/api/projects/:id/audit-runs/:runId` | Status + summary |
| GET | `/api/projects/:id/findings` | List (filter type/direction/status) |
| GET | `/api/findings/:id` | Detail + calculation + related records |
| PATCH | `/api/findings/:id/status` | OPEN→REVIEWED→… + FindingEvent |
| GET | `/api/projects/:id/findings/export.csv` | CSV export |

All routes enforce workspace isolation.

---

## D. MVP Implementation Phases

Each phase is independently testable. Do not start phase *N+1* until phase *N* acceptance passes.

### Phase 0 — Repo bootstrap  
**Depends on:** nothing  

| Item | Detail |
|------|--------|
| Files | `package.json`, TS config, lint, `src/` skeleton, migration tool |
| DB | Connection only |
| Tests | `health` smoke |
| Acceptance | `npm test` / `npm run typecheck` green |

---

### Phase 1 — Tenancy, auth, projects  
**Depends on:** Phase 0  

| Item | Detail |
|------|--------|
| Tables | workspaces, users, workspace_memberships, projects |
| API | Auth, project CRUD |
| UI | Login, project list/create |
| Tests | Isolation: user A cannot read user B project |
| Acceptance | Create workspace + project; RBAC roles enforced |

---

### Phase 2 — Document upload + import shell  
**Depends on:** Phase 1  

| Item | Detail |
|------|--------|
| Tables | documents, imports, raw_records |
| API | Upload CSV → Document + Import; list imports |
| Logic | Store file; parse rows into RawRecord (no normalize yet) |
| UI | Upload form on project |
| Tests | Upload sample `change_orders.csv`; row_count matches |
| Acceptance | Raw rows persisted with source_row |

---

### Phase 3 — Column mapping + normalization  
**Depends on:** Phase 2  

| Item | Detail |
|------|--------|
| Tables | contract_sov_lines, change_orders, change_order_lines, tm_tickets, billing_items, rate_table |
| Modules | `mapColumns`, `normalize` (Zod from schemas) |
| API | Save mapping; commit import → normalized entities + provenance |
| UI | Simple mapping UI (source column → target field) |
| Tests | Normalize each sample CSV; required fields present; types coerced; line_id string |
| Acceptance | All `data/samples/*.csv` import cleanly with provenance; schema validation errors reported |

---

### Phase 4 — Matching service (L1–L3)  
**Depends on:** Phase 3  

| Item | Detail |
|------|--------|
| Tables | matches |
| Modules | `matching.ts` — exact_id, strong_composite, structured_attributes |
| Logic | CO↔billing by change_order_id; T&M↔CO by linked_change_order_id; no fuzzy auto-HIGH |
| Tests | Exact matches for sample; unknown ticket does not invent CO link |
| Acceptance | Match records written with method + confidence; L4 not implemented (or candidates only, never auto-finding) |

---

### Phase 5 — Deterministic AuditEngine (highest priority core)  
**Depends on:** Phase 4 (can start pure rules earlier with fixture loaders)  

| Item | Detail |
|------|--------|
| Modules | `engine.ts`, `rules/rule001…010.ts`, `materiality.ts`, `grouping.ts`, `severity.ts` |
| Logic | Pure function: normalized snapshot + as_of_date + settings → FindingDraft[] |
| Rules | Implement 001,002,003,006,007,008,009,010 per `03-detection-rules.md` (004/005 as specified: 004 if data present; 005 informational only) |
| Precedence | 007/008/009 primary; 002 related when same CO; dashboard counts once |
| Tests | **See section E** — must pass before any findings UI |
| Acceptance | Against sample data @ `as_of=2025-08-15`, primary findings **exactly** match `expected_findings.json` |

---

### Phase 6 — AuditRun + Finding persistence  
**Depends on:** Phase 5  

| Item | Detail |
|------|--------|
| Tables | audit_runs, findings, finding_events |
| API | POST audit-run; GET findings; PATCH status |
| Logic | Persist drafts; emit FindingEvent `created`; status transitions append events |
| Tests | Run audit → N findings; dismiss → event row; re-run creates new AuditRun |
| Acceptance | Findings queryable; current_status + event history correct |

---

### Phase 7 — Findings UI + CSV export  
**Depends on:** Phase 6  

| Item | Detail |
|------|--------|
| UI | Findings table (type, direction, amount, severity, status); detail page with calculation, source IDs, related findings |
| Dashboard | Four buckets: Underbilling / Overbilling / Evidence / Data Quality (not one blended number) |
| API | Export CSV |
| Tests | Export contains finding ids and amounts; bucket totals match grouping rules |
| Acceptance | Contractor path: project → import samples → run audit → see findings → export CSV |

---

### Phase 8 — Hardening & false-positive suite  
**Depends on:** Phase 7  

| Item | Detail |
|------|--------|
| Tests | Full adversarial set from audit (delayed billing, credits, retainage, non-billable T&M, progressive billing, lump-sum exclusions, etc.) |
| Docs | Update acceptance log |
| Acceptance | All automated tests green; no silent spec changes |

**Stop here for v1.0 MVP.** Do not start PDF/AI/integrations until product validation on real contractor CSVs.

---

## E. Automated Test Plan

Financial tests **must not** depend on UI or HTTP.

### E.1 Fixture loader

Load `data/samples/*.csv` + `expected_findings.json` into in-memory normalized records (same shapes as DB models).

### E.2 Ground-truth suite (oracle)

| Test | Assert |
|------|--------|
| `expected_findings_match` | Primary findings == expected set (rule + entity key) |
| `amounts_match` | amount_signed / amount_at_risk within $0.01 |
| `directions_match` | financial_direction per expected |
| `dashboard_buckets` | Underbilling $35,285; Overbilling $11,200; Evidence $4,500; RULE 006 not in underbilling |
| `no_extras` | No primary finding outside expected list |
| `tm042_only_rule003` | Unlinked non_billable/unknown T&M do not produce RULE 003 |

### E.3 Per-rule unit tests

For each rule file: inputs → single finding or empty; cover materiality boundary, grace period, cancelled status, credit.

### E.4 Adversarial / false-positive tests

| Case | Expect |
|------|--------|
| Billing within grace | No RULE 001/003 |
| CO-005 progressive periods | No RULE 009 |
| CO-015 credit | No revenue finding |
| CO-002 submitted≠approved | No revenue finding (005 info only if implemented) |
| Non-billable T&M | No RULE 003 |
| Lump-sum line qty “2” from two invoices | No RULE 007 |
| Lump-sum unit_price partial | No RULE 008 |
| Retainage-only difference | No REVENUE_AT_RISK |
| Cancelled CO | No RULE 001/002 |
| Fuzzy candidate only | No HIGH financial finding without user_confirmed |

### E.5 Schema / normalization tests

- `line_id` remains string  
- Invalid enum rejected  
- Missing required field → import warning/error  
- FK: billing change_order_id not in CO set → RULE 004 if implemented  

### E.6 Matching tests

- Exact CO id links billing  
- Missing link does not invent match  
- user_confirmed elevates confidence  

### E.7 Isolation tests

- Cross-workspace read returns 404/403  

### E.8 CI gate

Phase 5+ cannot merge unless `tests/audit/**` pass including oracle suite.

---

## F. Acceptance Criteria (v1.0)

### Engine (blocking)

1. Running AuditEngine on synthetic project with `as_of_date=2025-08-15` produces **exactly** the primary findings in `expected_findings.json`.  
2. Every finding includes: related record IDs, calculation text, calculation_json operands, confidence, financial_direction, amount_signed.  
3. Dashboard bucket totals match grouped economics (no double-count of CO-019).  
4. All adversarial false-positive tests pass.  
5. No AI/LLM call is on the path that creates monetary findings.

### Product path (blocking)

1. Authenticated user creates a project.  
2. Uploads the sample CSVs (or equivalent contractor CSVs).  
3. Maps columns and commits normalization.  
4. Runs an audit with an as-of date.  
5. Views findings list + detail with provenance.  
6. Exports findings CSV.  
7. Tenant isolation holds under automated tests.

### Non-goals for v1.0 acceptance

- PDF extraction, AI extraction, PDF report polish, live integrations, mobile, multi-currency.

---

## G. Intentionally Deferred Features

| Feature | Reason |
|---------|--------|
| PDF upload & text extraction | Spec allows later; not required for financial proof |
| AI document extraction / field normalization prompts | After deterministic path is proven |
| XLSX as first-class (beyond CSV) | Same pipeline; defer UI |
| Live Procore / accounting integrations | Import-first positioning |
| Rich evidence viewer / PDF page viewer | Store links; UI later |
| Configurable materiality UI | Defaults in workspace_settings sufficient |
| RULE 005 as active revenue rule | Spec: informational only |
| T&M LaborLine/MaterialLine sub-rows | Header amounts sufficient for v1.0 rules |
| Fuzzy matching auto-findings | Forbidden by spec |
| PDF audit report | CSV export is the v1.0 deliverable |
| Multi-currency / retainage-as-finding | Explicit non-goals / guardrails |
| Mobile app | Out of scope |

---

## Ambiguity protocol

If code cannot be written without choosing between two interpretations of the frozen docs:

1. Stop.  
2. Cite the conflicting sections.  
3. Do not ship a silent choice.  
4. Resolve via spec amendment (v1.1) if needed.

---

## Phase dependency graph (summary)

```
0 Bootstrap
 └─ 1 Auth / Projects
      └─ 2 Upload / Raw import
           └─ 3 Mapping / Normalize
                └─ 4 Matching
                     └─ 5 AuditEngine + oracle tests   ← critical path peak
                          └─ 6 Persist AuditRun / Findings
                               └─ 7 UI + CSV export
                                    └─ 8 Hardening
```

**Recommended build order for a solo implementer:**  
Phases 0 → 1 → (3 fixture loader + 5 engine in parallel with pure tests) → 2 → 3 → 4 → 6 → 7 → 8.

The reconciliation engine (Phase 5) is the highest-priority component; its tests may run against fixture loaders before the full import stack exists.
