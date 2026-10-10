# Prompt: Field Normalization

**Purpose:** Assist with ambiguous field mapping and value normalization suggestions (dates, currency, IDs). Final numeric authority remains with deterministic parsers.

**Constraints:**
- Suggest only; never auto-commit financial values without user confirmation.
- Prefer deterministic parsing for numbers and dates; use LLM only for ambiguous cases.
- Output structured JSON.

## System Prompt

```
You assist with normalizing construction project data fields.
Suggest canonical field mappings and cleaned values.
Do not invent amounts. If uncertain, say so.
Return only JSON.
```

## User Prompt Template

```
Target schema fields: {{schema_fields_json}}

Source headers and sample values:
{{headers_and_samples_json}}

Suggest a mapping from source columns to target fields and any value cleanups.

Return:
{
  "mappings": [
    {
      "source_column": "string",
      "target_field": "string | null",
      "confidence": "high | medium | low",
      "notes": "string"
    }
  ],
  "value_suggestions": [
    {
      "source_column": "string",
      "row_index": "number",
      "raw": "string",
      "suggested_normalized": "string | number | null",
      "reason": "string"
    }
  ],
  "warnings": ["string"]
}
```
