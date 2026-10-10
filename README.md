# Construction Revenue Audit

**Working name:** Construction Revenue Audit

A financial QA and revenue-protection tool for commercial specialty contractors.

> **Central promise:** Find construction revenue that your existing workflow may have missed, under-billed, or failed to properly support.

## What This Product Is

An independent verification/audit layer that sits **beside** existing construction management, T&M, and accounting systems. It reviews project records and detects:

- Unbilled or partially billed change orders
- Documented extra/T&M work that may not have reached billing
- Billing amounts that do not match approved changes
- Discrepancies between contract value, approved changes, and billing
- Duplicate or conflicting records
- Billed change work with weak or missing supporting evidence
- Other financially meaningful inconsistencies

## What This Product Is Not

- Not a replacement for Procore, Clearstory, Raken, eSUB, Sage, QuickBooks, or ERP systems
- Not a field timesheet / mobile field app
- Not a CRM, payroll, accounting, or scheduling system
- Not a full document-management system

## Initial Customer Profile (ICP)

- **Primary vertical:** US commercial electrical subcontractors
- **Company size:** ~10–100 employees
- **Work type:** Commercial / industrial / institutional
- **Characteristics:** Multiple active projects, regular change orders and/or T&M, meaningful project billing, already using spreadsheets and/or construction software

**Out of scope initially:** Residential service electricians, one-person contractors, giant national enterprises.

Architecture remains extensible to mechanical, plumbing, HVAC, and other specialty contractors.

## MVP Input Priority

1. CSV
2. XLSX
3. Text-based PDF
4. Manual corrections / manual entry where required

**No live integrations required for MVP.**

## Core Engineering Principle

Strict separation of concerns:

1. **Extraction**
2. **Normalization**
3. **Deterministic financial rules**
4. **Evidence linking**
5. **AI-assisted interpretation** (never invents financial findings)

Every monetary finding is traceable to structured values extracted from source records.

## Quick Start (After Implementation)

```bash
# See docs/ for full specification
# See AGENTS.md for coding agent instructions
```

## Documentation Index

| Document | Purpose |
|----------|---------|
| [docs/00-product-overview.md](docs/00-product-overview.md) | Product vision, ICP, differentiation |
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | In-scope / out-of-scope, non-goals |
| [docs/02-data-model.md](docs/02-data-model.md) | Entities, schemas, provenance |
| [docs/03-detection-rules.md](docs/03-detection-rules.md) | Deterministic rules RULE 001–010 |
| [docs/04-findings-taxonomy.md](docs/04-findings-taxonomy.md) | Finding types, severity, confidence |
| [docs/05-severity-scoring.md](docs/05-severity-scoring.md) | Severity scoring formula |
| [docs/06-import-workflow.md](docs/06-import-workflow.md) | Upload → map → validate → audit |
| [docs/07-ui-ux.md](docs/07-ui-ux.md) | Navigation, key screens, design principles |
| [docs/08-reporting.md](docs/08-reporting.md) | Audit report structure |
| [docs/09-security.md](docs/09-security.md) | Auth, isolation, encryption, retention |
| [docs/10-architecture.md](docs/10-architecture.md) | Tech stack, layers, deployment |
| [docs/11-testing-strategy.md](docs/11-testing-strategy.md) | Unit, integration, false-positive tests |
| [docs/12-competitive-landscape.md](docs/12-competitive-landscape.md) | Competitors, overlap, differentiation |
| [docs/13-implementation-phases.md](docs/13-implementation-phases.md) | PHASE 1–12 order |
| [docs/14-acceptance-criteria.md](docs/14-acceptance-criteria.md) | Technical & product success criteria |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents |
| [prompts/](prompts/) | AI extraction / normalization prompts |
| [schemas/](schemas/) | JSON schemas for data types |
| [data/samples/](data/samples/) | Synthetic project + expected findings |

## License

Proprietary — all rights reserved.
