# 01 — MVP Scope

**Spec version:** 1.0.0 — see [00-SPEC-VERSION.md](00-SPEC-VERSION.md) and [17-implementation-plan-v1.md](17-implementation-plan-v1.md).

## v1.0 critical path (in scope)

```
CSV upload → column mapping → validation/normalization → matching
→ deterministic audit rules → findings → finding detail/provenance → CSV export
```

Auth, workspace isolation, and project CRUD are required infrastructure for the path above.

## Explicitly out of v1.0 critical path

- PDF upload / PDF text extraction
- AI-assisted document extraction
- Live integrations (Procore, ERP, accounting)
- PDF report generation (CSV export is sufficient)
- Mobile applications
- Multi-currency
- Rich evidence document viewer
- Workspace UI for materiality configuration (defaults only)

# 01 — MVP Scope

**Related:** [00-product-overview.md](00-product-overview.md) · [13-implementation-phases.md](13-implementation-phases.md) · [14-acceptance-criteria.md](14-acceptance-criteria.md)

## In Scope (MVP)

### User Workflow

1. Create account / workspace
2. Create project
3. Upload project records
4. Assign each file a document / data type
5. System parses records
6. System normalizes fields
7. System attempts record matching
8. Rule engine runs
9. Exceptions (findings) are generated
10. User reviews findings
11. User can correct mappings
12. System recalculates
13. User can export an audit report

### Input Formats (Priority Order)

1. CSV
2. XLSX
3. Text-based PDF
4. Manual corrections / manual entry where required

### Data Types

- Contract / SOV
- Change Orders
- T&M Tickets
- Billing / Pay Applications / Invoices
- Supporting Evidence

See [02-data-model.md](02-data-model.md) for full schemas.

### Detection Rules

Deterministic rules RULE 001–010. See [03-detection-rules.md](03-detection-rules.md).

### Findings

Controlled taxonomy, severity, confidence. See [04-findings-taxonomy.md](04-findings-taxonomy.md) and [05-severity-scoring.md](05-severity-scoring.md).

### UI

Primary navigation: Dashboard · Projects · Findings · Imports · Reports · Settings

Most important screen: Findings.

See [07-ui-ux.md](07-ui-ux.md).

### Reporting

CSV + printer-friendly PDF audit report. See [08-reporting.md](08-reporting.md).

### Security

Tenant isolation, authentication, authorization, encryption, audit trail. See [09-security.md](09-security.md).

## Explicit Non-Goals (MVP)

Do **NOT** build in the first MVP:

- Mobile field app
- GPS tracking
- Payroll
- CRM
- Estimating platform
- Scheduling
- Full ERP
- Accounting replacement
- Live Procore integration
- Live QuickBooks integration
- Live Sage integration
- Subcontractor marketplace
- Customer portal
- Automated collections
- Payment processing
- Complex AI agent system
- Automatic legal advice
- Automatic dispute escalation

These may be considered later after validation.

## Import Constraints

- No live integrations required for MVP
- No mobile field-worker adoption required for MVP
- System must tolerate different column names, date formats, currency symbols, commas, blank values, duplicated rows, inconsistent IDs
- Do not silently discard problematic records — show data-quality warnings

## AI Constraints

- AI is useful for unstructured documents (extraction, classification, semantic relationships, summarization)
- AI must **never** invent financial findings
- Every financial finding must ultimately be traceable to structured values
- Retain: original extracted text/value + normalized value + confidence + source location

## Success Criteria

See [14-acceptance-criteria.md](14-acceptance-criteria.md).
