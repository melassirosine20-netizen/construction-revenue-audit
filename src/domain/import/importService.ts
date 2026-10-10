/**
 * ImportService — Phase 2 upload + Phase 3 mapping/normalization
 * Spec: docs/06-import-workflow.md · docs/17-implementation-plan-v1.md § Phase 2–3
 *
 * Responsibilities:
 *  - Validate file size / type
 *  - Store original bytes (local disk for MVP)
 *  - Create Document + Import records
 *  - Parse CSV → RawRecord with source_row provenance
 *  - Suggest / save column mapping
 *  - Commit: normalize + persist entities with provenance
 *
 * Does NOT run matching or audit rules (Phase 4+).
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { DocumentType } from '../types.js';
import { parseCsv, type ParseCsvResult } from './parseCsv.js';
import {
  suggestMapping,
  validateMapping,
  type ColumnMapping,
  type SuggestMappingResult,
  type MappingValidationResult,
} from './mapColumns.js';
import {
  normalizeRows,
  resolveEntityKind,
  type NormalizeResult,
} from './normalize.js';
import type { MappingEntityKind } from './fieldCatalog.js';
import {
  DocumentRepo,
  ImportRepo,
  RawRecordRepo,
  type DocumentRecord,
  type ImportRecord,
} from '../../db/repos/documentRepo.js';
import { NormalizedRepo } from '../../db/repos/normalizedRepo.js';
import { ProjectRepo } from '../../db/repos/projectRepo.js';
import { AuthService } from '../auth/authService.js';

/** 10 MiB hard limit for a single CSV upload (MVP). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream', // browsers sometimes send this for .csv
]);

export interface UploadCsvInput {
  workspaceId: string;
  projectId: string;
  userId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
  documentType?: DocumentType;
}

export interface UploadCsvResult {
  document: DocumentRecord;
  importRecord: ImportRecord;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, string>[];
}

function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'data', 'uploads');
}

function ensureUploadDir(workspaceId: string, projectId: string): string {
  const dir = join(uploadsRoot(), workspaceId, projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function isCsvFilename(name: string): boolean {
  return /\.csv$/i.test(name);
}

export class ImportService {
  /**
   * Upload a CSV, store the original file, parse rows into RawRecords.
   * Requires the caller to be at least `member` of the workspace.
   */
  static async uploadCsv(input: UploadCsvInput): Promise<UploadCsvResult> {
    // Authorization
    await AuthService.requireRole(input.workspaceId, input.userId, 'member');

    // Project must belong to the workspace
    const project = await ProjectRepo.findById(input.workspaceId, input.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Size limit
    if (input.buffer.byteLength === 0) {
      throw new Error('Uploaded file is empty');
    }
    if (input.buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`File exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
    }

    // Basic type checks
    const contentType = (input.contentType || 'application/octet-stream').toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType) && !isCsvFilename(input.filename)) {
      throw new Error('Only CSV files are accepted in this phase');
    }

    // rate_table is a mapping entity kind, not a frozen DocumentType enum value.
    // Accept it as an upload hint by storing document_type=unknown; callers pass entityKind=rate_table.
    const documentType: DocumentType =
      input.documentType === ('rate_table' as DocumentType)
        ? 'unknown'
        : (input.documentType ?? 'unknown');

    // Persist original bytes (namespaced by workspace + project)
    ensureUploadDir(input.workspaceId, input.projectId);
    const storageKey = `${input.workspaceId}/${input.projectId}/${uuidv4()}_${sanitizeFilename(input.filename)}`;
    const absolutePath = join(uploadsRoot(), storageKey);
    writeFileSync(absolutePath, input.buffer);

    // Document record
    const document = await DocumentRepo.create({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      filename: input.filename,
      storageKey,
      contentType,
      sizeBytes: input.buffer.byteLength,
      documentType,
      uploadedBy: input.userId,
    });

    // Import record (starts as parsing)
    const importRecord = await ImportRepo.create({
      projectId: input.projectId,
      documentId: document.id,
      status: 'parsing',
    });

    // Parse
    const parsed: ParseCsvResult = parseCsv(input.buffer);
    if (!parsed.ok) {
      await ImportRepo.updateStatus(importRecord.id, 'failed', {
        errorCount: 1,
        warnings: [{ code: parsed.error.code, message: parsed.error.message }],
        completedAt: new Date().toISOString(),
      });
      throw new Error(`CSV parse failed: ${parsed.error.message}`);
    }

    // Persist raw records with source_row provenance
    const rawRows = parsed.data.rows.map((payload, idx) => ({
      sourceRow: parsed.data.sourceRows[idx],
      rawPayload: payload,
    }));
    const inserted = await RawRecordRepo.bulkInsert(
      importRecord.id,
      input.projectId,
      rawRows,
    );

    // Move to mapping status (ready for column mapping — Phase 3)
    await ImportRepo.updateStatus(importRecord.id, 'mapping', {
      rowCount: inserted,
      errorCount: 0,
      warnings: [],
    });

    const updated = await ImportRepo.findById(importRecord.id);

    return {
      document,
      importRecord: updated!,
      headers: parsed.data.headers,
      rowCount: inserted,
      sampleRows: parsed.data.rows.slice(0, 5),
    };
  }

  static async listImports(
    workspaceId: string,
    projectId: string,
    userId: string,
  ): Promise<ImportRecord[]> {
    await AuthService.requireRole(workspaceId, userId, 'viewer');
    const project = await ProjectRepo.findById(workspaceId, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return ImportRepo.listByProject(projectId);
  }

  static async getImport(
    workspaceId: string,
    projectId: string,
    importId: string,
    userId: string,
  ): Promise<{ importRecord: ImportRecord; rawCount: number }> {
    await AuthService.requireRole(workspaceId, userId, 'viewer');
    const project = await ProjectRepo.findById(workspaceId, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const importRecord = await ImportRepo.findById(importId);
    if (!importRecord || importRecord.projectId !== projectId) {
      throw new Error('Import not found');
    }
    const rawCount = await RawRecordRepo.countByImport(importId);
    return { importRecord, rawCount };
  }

  /**
   * Suggest column mappings from raw record headers + document type.
   */
  static async suggestColumnMapping(
    workspaceId: string,
    projectId: string,
    importId: string,
    userId: string,
    entityKind?: MappingEntityKind,
  ): Promise<SuggestMappingResult & { documentType: DocumentType }> {
    await AuthService.requireRole(workspaceId, userId, 'viewer');
    const { importRecord, document } = await loadImportContext(
      workspaceId,
      projectId,
      importId,
    );
    const raw = await RawRecordRepo.listByImport(importId);
    const headers =
      raw.length > 0
        ? Object.keys(raw[0].rawPayload)
        : [];
    const kind = entityKind ?? resolveEntityKind(document.documentType) ?? undefined;
    const suggestion = suggestMapping(headers, document.documentType, kind);
    return { ...suggestion, documentType: document.documentType };
  }

  /**
   * Persist a user-confirmed column mapping. Does not normalize yet.
   */
  static async saveMapping(
    workspaceId: string,
    projectId: string,
    importId: string,
    userId: string,
    mapping: ColumnMapping,
    entityKind?: MappingEntityKind,
  ): Promise<{ importRecord: ImportRecord; validation: MappingValidationResult }> {
    await AuthService.requireRole(workspaceId, userId, 'member');
    const { importRecord, document } = await loadImportContext(
      workspaceId,
      projectId,
      importId,
    );

    const kind =
      entityKind ?? resolveEntityKind(document.documentType) ?? undefined;
    if (!kind) {
      throw new Error('Document type is unknown; specify entityKind for mapping');
    }

    const validation = validateMapping(mapping, document.documentType, kind);
    if (!validation.valid) {
      // Still save the mapping so the user can iterate; stay in mapping status
      await ImportRepo.updateStatus(importId, 'mapping', {
        columnMapping: mapping as Record<string, string>,
        warnings: validation.issues,
      });
      const updated = await ImportRepo.findById(importId);
      return { importRecord: updated!, validation };
    }

    await ImportRepo.updateStatus(importId, 'validating', {
      columnMapping: mapping as Record<string, string>,
      warnings: [],
    });
    const updated = await ImportRepo.findById(importId);
    return { importRecord: updated!, validation };
  }

  /**
   * Commit import: normalize raw records with the saved mapping and persist entities.
   * Raw records are never deleted on failure.
   */
  static async commitImport(
    workspaceId: string,
    projectId: string,
    importId: string,
    userId: string,
    entityKind?: MappingEntityKind,
  ): Promise<{
    importRecord: ImportRecord;
    normalize: NormalizeResult;
    persistedCount: number;
  }> {
    await AuthService.requireRole(workspaceId, userId, 'member');
    const { importRecord, document } = await loadImportContext(
      workspaceId,
      projectId,
      importId,
    );

    if (!importRecord.columnMapping) {
      throw new Error('Column mapping has not been saved for this import');
    }

    const kind =
      entityKind ?? resolveEntityKind(document.documentType) ?? undefined;
    if (!kind) {
      throw new Error('Document type is unknown; specify entityKind for commit');
    }

    const validation = validateMapping(
      importRecord.columnMapping,
      document.documentType,
      kind,
    );
    if (!validation.valid) {
      throw new Error(
        `Mapping is incomplete: ${validation.issues.map((i) => i.message).join('; ')}`,
      );
    }

    const raw = await RawRecordRepo.listByImport(importId);
    const normalize = normalizeRows(
      {
        workspaceId,
        projectId,
        sourceDocumentId: document.id,
        sourceImportId: importId,
        documentType: document.documentType,
        entityKind: kind,
        mapping: importRecord.columnMapping,
      },
      raw.map((r) => ({ sourceRow: r.sourceRow, rawPayload: r.rawPayload })),
    );

    let persistedCount = 0;
    if (normalize.entities.length > 0) {
      persistedCount = await NormalizedRepo.persistEntities(importId, normalize.entities);
    }

    const status = normalize.errorCount > 0 && normalize.successCount === 0 ? 'failed' : 'imported';
    await ImportRepo.updateStatus(importId, status, {
      rowCount: importRecord.rowCount,
      errorCount: normalize.errorCount,
      warnings: normalize.warnings,
      completedAt: new Date().toISOString(),
    });

    const updated = await ImportRepo.findById(importId);
    return { importRecord: updated!, normalize, persistedCount };
  }
}

async function loadImportContext(
  workspaceId: string,
  projectId: string,
  importId: string,
): Promise<{ importRecord: ImportRecord; document: DocumentRecord }> {
  const project = await ProjectRepo.findById(workspaceId, projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  const importRecord = await ImportRepo.findById(importId);
  if (!importRecord || importRecord.projectId !== projectId) {
    throw new Error('Import not found');
  }
  const document = await DocumentRepo.findById(workspaceId, importRecord.documentId);
  if (!document) {
    throw new Error('Document not found');
  }
  return { importRecord, document };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}
