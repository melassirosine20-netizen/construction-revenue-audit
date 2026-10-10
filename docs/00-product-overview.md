# 00 — Product Overview

**Related:** [01-mvp-scope.md](01-mvp-scope.md) · [12-competitive-landscape.md](12-competitive-landscape.md) · [README.md](../README.md)

## Working Name

Construction Revenue Audit

## Core Product

A financial QA and revenue-protection tool for commercial specialty contractors.

The system reviews construction project records and detects potential:

- Unbilled change orders
- Partially billed change orders
- Documented extra / T&M work that may not have reached billing
- Billing amounts that do not match approved changes
- Discrepancies between contract value, approved changes, and billing
- Duplicate or conflicting records
- Billed change work with weak or missing supporting evidence
- Other financially meaningful inconsistencies between project records

## Positioning

The product is **not** a replacement for Procore, Clearstory, Raken, eSUB, Sage, QuickBooks, ERP systems, T&M field apps, or construction management platforms.

It is an **independent verification / audit layer** that can sit beside them.

### Central Promise

> "Find construction revenue that your existing workflow may have missed, under-billed, or failed to properly support."

### Differentiation Hypothesis

> "Your construction software records what happened. We check whether the money actually reconciles."

Potential advantages (unvalidated until customer research):

- Simpler and faster setup
- Import existing exports (CSV / XLSX / PDF)
- Independent verification
- Transparent, auditable calculations
- Better exception reporting
- Evidence-linked findings
- Affordable for smaller contractors
- No need to replace existing systems

## Initial Customer (ICP)

| Attribute | Value |
|-----------|-------|
| Geography | United States |
| Vertical (first) | Commercial electrical subcontractors |
| Company size | Approximately 10–100 employees |
| Work type | Commercial / industrial / institutional |
| Project volume | Multiple active projects |
| Change activity | Regular change orders and/or T&M work |
| Billing | Meaningful project billing |
| Current tools | Spreadsheets and/or construction software |

### Do Not Initially Target

- Residential service electricians
- One-person contractors
- Giant national construction enterprises
- General consumer construction management

### Future Extensibility

Architecture must remain extensible to mechanical, plumbing, HVAC, and other specialty contractors.

## Core Product Principle

Do **not** build another construction management system.

The software should work with records the contractor already has.

## Most Important Engineering Principle

Separate:

1. Extraction
2. Normalization
3. Deterministic financial rules
4. Evidence linking
5. AI-assisted interpretation

AI can help extract messy documents, classify records, and explain findings.  
AI **cannot** silently alter numeric facts or invent financial findings.

See [03-detection-rules.md](03-detection-rules.md) and [prompts/](../prompts/) for details.
