# Prompt: Document Extraction

**Purpose:** Extract structured fields from unstructured or semi-structured construction documents (primarily text-based PDFs).

**Constraints:**
- Output **only** valid JSON matching the schema below.
- Never invent monetary amounts that are not present in the source text.
- Preserve original text snippets for every extracted value.
- Include source location (page, approximate region) when possible.
- If a field cannot be found with reasonable confidence, set it to `null` and lower confidence.

## System Prompt

```
You are a precise document extraction engine for construction financial records.
Extract only facts that appear in the provided text. Do not calculate, infer, or invent amounts.
Return a single JSON object. No markdown, no commentary.
```

## User Prompt Template

```
Document type hint: {{document_type}}
Project context (optional): {{project_name}}

--- BEGIN DOCUMENT TEXT ---
{{document_text}}
--- END DOCUMENT TEXT ---

Extract fields according to this JSON schema:

{
  "document_type": "contract_sov | change_order | tm_ticket | billing | evidence | unknown",
  "confidence": "high | medium | low",
  "records": [
    {
      "record_type": "string",
      "fields": {
        "<field_name>": {
          "value": "string | number | null",
          "raw_text": "string",
          "page": "number | null",
          "confidence": "high | medium | low"
        }
      }
    }
  ],
  "warnings": ["string"]
}

Use the field names defined for the corresponding data type in the product schemas.
If multiple records exist (e.g. multiple line items), return one object per record in the "records" array.
```

## Post-Processing Requirements

- Validate JSON against schema.
- Store `raw_text` and page reference with every normalized value.
- Present extracted candidates to the user for mapping confirmation before committing financial numbers.
