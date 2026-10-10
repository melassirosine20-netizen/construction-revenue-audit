/**
 * Column mapping — suggest + validate
 * Spec: docs/06-import-workflow.md · Phase 3
 *
 * Does NOT silently assign ambiguous financial mappings.
 * Exact alias match → suggested. Multiple targets claiming same header → ambiguous (unassigned).
 */
import type { DocumentType } from '../types.js';
import {
  getFieldsForDocumentType,
  getFieldsForEntity,
  normalizeHeader,
  type FieldDef,
  type MappingEntityKind,
} from './fieldCatalog.js';

/** sourceHeader → targetFieldName (or null if unmapped) */
export type ColumnMapping = Record<string, string | null>;

export interface MappingSuggestion {
  sourceHeader: string;
  targetField: string | null;
  confidence: 'exact' | 'alias' | 'none';
  reason: string;
}

export interface MappingValidationIssue {
  code:
    | 'MISSING_REQUIRED'
    | 'DUPLICATE_TARGET'
    | 'UNKNOWN_TARGET'
    | 'AMBIGUOUS_HEADER'
    | 'EMPTY_MAPPING';
  message: string;
  field?: string;
  sourceHeader?: string;
}

export interface MappingValidationResult {
  valid: boolean;
  issues: MappingValidationIssue[];
  /** Required target fields that are mapped */
  mappedRequired: string[];
  /** Required target fields still missing */
  missingRequired: string[];
}

export interface SuggestMappingResult {
  suggestions: MappingSuggestion[];
  /** Auto-built mapping from non-ambiguous suggestions only */
  proposedMapping: ColumnMapping;
  ambiguities: Array<{ sourceHeader: string; candidateFields: string[] }>;
}

/**
 * Suggest mappings from CSV headers to target fields.
 * Only high-confidence (exact name or known alias) matches are proposed.
 * If one header matches multiple targets, it is left unmapped and flagged.
 */
export function suggestMapping(
  headers: string[],
  documentType: DocumentType,
  entityKind?: MappingEntityKind,
): SuggestMappingResult {
  const fields = entityKind
    ? getFieldsForEntity(entityKind)
    : getFieldsForDocumentType(documentType);

  const ambiguities: Array<{ sourceHeader: string; candidateFields: string[] }> = [];
  const suggestions: MappingSuggestion[] = [];
  const proposedMapping: ColumnMapping = {};

  // Build reverse index: normalized alias → field names
  const aliasToFields = new Map<string, string[]>();
  for (const field of fields) {
    const keys = new Set<string>([normalizeHeader(field.name), ...field.aliases]);
    for (const key of keys) {
      const list = aliasToFields.get(key) ?? [];
      if (!list.includes(field.name)) list.push(field.name);
      aliasToFields.set(key, list);
    }
  }

  const usedTargets = new Set<string>();

  for (const header of headers) {
    const norm = normalizeHeader(header);
    const candidates = aliasToFields.get(norm) ?? [];

    if (candidates.length === 0) {
      suggestions.push({
        sourceHeader: header,
        targetField: null,
        confidence: 'none',
        reason: 'No recognized alias',
      });
      proposedMapping[header] = null;
      continue;
    }

    if (candidates.length > 1) {
      ambiguities.push({ sourceHeader: header, candidateFields: candidates });
      suggestions.push({
        sourceHeader: header,
        targetField: null,
        confidence: 'none',
        reason: `Ambiguous: matches ${candidates.join(', ')}`,
      });
      proposedMapping[header] = null;
      continue;
    }

    const target = candidates[0];
    if (usedTargets.has(target)) {
      // Another header already claimed this target — do not auto-assign
      suggestions.push({
        sourceHeader: header,
        targetField: null,
        confidence: 'none',
        reason: `Target ${target} already suggested for another header`,
      });
      proposedMapping[header] = null;
      continue;
    }

    const isExact = normalizeHeader(target) === norm;
    usedTargets.add(target);
    suggestions.push({
      sourceHeader: header,
      targetField: target,
      confidence: isExact ? 'exact' : 'alias',
      reason: isExact ? 'Exact header match' : `Alias match for ${target}`,
    });
    proposedMapping[header] = target;
  }

  return { suggestions, proposedMapping, ambiguities };
}

/**
 * Validate a user-confirmed (or proposed) mapping.
 * mapping keys = source headers, values = target field names (or null).
 */
export function validateMapping(
  mapping: ColumnMapping,
  documentType: DocumentType,
  entityKind?: MappingEntityKind,
): MappingValidationResult {
  const fields = entityKind
    ? getFieldsForEntity(entityKind)
    : getFieldsForDocumentType(documentType);
  const fieldNames = new Set(fields.map((f) => f.name));
  const required = fields.filter((f) => f.required).map((f) => f.name);

  const issues: MappingValidationIssue[] = [];
  const targetCounts = new Map<string, string[]>(); // target → source headers

  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    issues.push({ code: 'EMPTY_MAPPING', message: 'Mapping is empty' });
  }

  for (const [source, target] of entries) {
    if (target == null || target === '') continue;
    if (!fieldNames.has(target)) {
      issues.push({
        code: 'UNKNOWN_TARGET',
        message: `Unknown target field "${target}" for source header "${source}"`,
        field: target,
        sourceHeader: source,
      });
      continue;
    }
    const list = targetCounts.get(target) ?? [];
    list.push(source);
    targetCounts.set(target, list);
  }

  for (const [target, sources] of targetCounts) {
    if (sources.length > 1) {
      issues.push({
        code: 'DUPLICATE_TARGET',
        message: `Target field "${target}" is mapped from multiple headers: ${sources.join(', ')}`,
        field: target,
      });
    }
  }

  const mappedTargets = new Set(
    [...targetCounts.keys()].filter((t) => (targetCounts.get(t)?.length ?? 0) === 1),
  );
  const mappedRequired = required.filter((r) => mappedTargets.has(r));
  const missingRequired = required.filter((r) => !mappedTargets.has(r));

  for (const field of missingRequired) {
    const def = fields.find((f) => f.name === field);
    issues.push({
      code: 'MISSING_REQUIRED',
      message: `Required field "${def?.label ?? field}" (${field}) is not mapped`,
      field,
    });
  }

  const blocking = issues.filter(
    (i) =>
      i.code === 'MISSING_REQUIRED' ||
      i.code === 'DUPLICATE_TARGET' ||
      i.code === 'UNKNOWN_TARGET' ||
      i.code === 'EMPTY_MAPPING',
  );

  return {
    valid: blocking.length === 0,
    issues,
    mappedRequired,
    missingRequired,
  };
}

/**
 * Invert mapping: targetField → sourceHeader (only uniquely mapped targets).
 */
export function invertMapping(mapping: ColumnMapping): Record<string, string> {
  const inv: Record<string, string> = {};
  for (const [source, target] of Object.entries(mapping)) {
    if (target) inv[target] = source;
  }
  return inv;
}

export function requiredFields(
  documentType: DocumentType,
  entityKind?: MappingEntityKind,
): FieldDef[] {
  const fields = entityKind
    ? getFieldsForEntity(entityKind)
    : getFieldsForDocumentType(documentType);
  return fields.filter((f) => f.required);
}
