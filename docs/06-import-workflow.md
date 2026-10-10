# 06 — Import Workflow

**Related:** [02-data-model.md](02-data-model.md) · [01-mvp-scope.md](01-mvp-scope.md) · [prompts/document-extraction.md](../prompts/document-extraction.md)

## Design Goals

- Simple enough for a project manager / controller with no training.
- Tolerant of real-world messy files.
- Never silently discard data.
- Preserve full provenance.

## Step-by-Step Flow

### Step 1 — Upload File

User selects one or more files (CSV, XLSX, PDF).  
System stores the original file in object storage and creates a `Document` record.

### Step 2 — Choose or Detect Document Type

User assigns (or confirms auto-detected) type:

- Contract / SOV
- Change Order
- T&M Ticket
- Billing / Pay Application / Invoice
- Supporting Evidence
- Unknown (manual classification later)

### Step 3 — Preview Parsed Columns

System shows:
- Detected headers
- Sample rows (first N)
- Inferred data types
- Any obvious parsing issues

### Step 4 — Map Unknown Columns

User maps source columns → target schema fields.  
System suggests mappings based on header name similarity and sample values.  
User can leave non-required fields unmapped.

### Step 5 — Validate

System runs:
- Required field presence
- Type coercion (dates, currency, numbers)
- Duplicate key detection within the import
- Referential checks where possible (e.g. project ID consistency)

Issues are returned as **warnings** or **errors**.  
Errors block import; warnings do not.

### Step 6 — Import

- Create `Import` record
- Persist `RawRecord`s (original payload)
- Create / upsert `NormalizedRecord`s with provenance links
- Surface data-quality warnings on the import and on the project

### Step 7 — Run Audit

User triggers (or system auto-triggers) an `AuditRun`.  
Rule engine executes against current normalized data.  
Findings are generated and stored.

## Tolerance Requirements

The system **must** tolerate:

| Issue | Behavior |
|-------|----------|
| Different column names | Mapping UI + fuzzy suggestions |
| Different date formats | Multi-format parser + user confirmation |
| Currency symbols / commas | Strip and parse as decimal |
| Blank values | Allow for optional fields; warn for required |
| Duplicated rows | Detect and warn; do not auto-delete |
| Inconsistent IDs | Store as-is; flag in data-quality |
| Mixed number formats | Parse with locale-aware logic where possible |

## Data-Quality Warnings

Never silently discard.  
Examples of warnings:

- “Row 47: amount could not be parsed — stored as raw text”
- “3 rows have duplicate change_order_id”
- “Date format inconsistent across file”
- “Column ‘Amt’ mapped to approved_amount; 2 values negative”

Warnings appear on the Import detail page and feed into `DATA_QUALITY` findings when they affect audit reliability.

## Re-import & Corrections

- User may re-map and re-import.
- Previous normalized records from the same document are superseded (soft versioning) while raw records remain.
- Audit must be re-run after corrections.

## AI Assistance (Later Phases)

For PDFs and unstructured text, AI extraction (see prompts) produces candidate fields.  
User still reviews and confirms mapping.  
AI never auto-commits financial numbers without human confirmation in the mapping step.
