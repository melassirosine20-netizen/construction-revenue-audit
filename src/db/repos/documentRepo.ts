/**
 * Document, Import, and RawRecord repositories
 * Phase 2 — Document upload + import shell
 * Spec: docs/02-data-model.md · docs/17-implementation-plan-v1.md § Phase 2
 *
 * All queries that touch project data require workspace_id or project_id
 * already validated by the caller (AuthService.requireRole).
 */
import { getDb, saveDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import type { DocumentType, ImportStatus } from '../../domain/types.js';

export interface DocumentRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  filename: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  documentType: DocumentType;
  uploadedBy: string;
  createdAt: string;
}

export interface ImportRecord {
  id: string;
  projectId: string;
  documentId: string;
  status: ImportStatus;
  columnMapping: Record<string, string> | null;
  rowCount: number;
  errorCount: number;
  warnings: unknown[] | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RawRecordRow {
  id: string;
  importId: string;
  projectId: string;
  sourceRow: number;
  rawPayload: Record<string, string>;
  createdAt: string;
}

export class DocumentRepo {
  static async create(input: {
    projectId: string;
    workspaceId: string;
    filename: string;
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    documentType: DocumentType;
    uploadedBy: string;
  }): Promise<DocumentRecord> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO documents
        (id, project_id, workspace_id, filename, storage_key, content_type, size_bytes, document_type, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.projectId,
        input.workspaceId,
        input.filename,
        input.storageKey,
        input.contentType,
        input.sizeBytes,
        input.documentType,
        input.uploadedBy,
        now,
      ],
    );
    saveDb();

    return {
      id,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      filename: input.filename,
      storageKey: input.storageKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      documentType: input.documentType,
      uploadedBy: input.uploadedBy,
      createdAt: now,
    };
  }

  static async findById(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, workspace_id as workspaceId, filename,
              storage_key as storageKey, content_type as contentType, size_bytes as sizeBytes,
              document_type as documentType, uploaded_by as uploadedBy, created_at as createdAt
       FROM documents WHERE id = ? AND workspace_id = ?`,
    );
    stmt.bind([documentId, workspaceId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as DocumentRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  static async listByProject(
    workspaceId: string,
    projectId: string,
  ): Promise<DocumentRecord[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, workspace_id as workspaceId, filename,
              storage_key as storageKey, content_type as contentType, size_bytes as sizeBytes,
              document_type as documentType, uploaded_by as uploadedBy, created_at as createdAt
       FROM documents WHERE workspace_id = ? AND project_id = ?
       ORDER BY created_at DESC`,
    );
    stmt.bind([workspaceId, projectId]);
    const list: DocumentRecord[] = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject() as unknown as DocumentRecord);
    }
    stmt.free();
    return list;
  }
}

export class ImportRepo {
  static async create(input: {
    projectId: string;
    documentId: string;
    status?: ImportStatus;
  }): Promise<ImportRecord> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    const status = input.status ?? 'pending';

    db.run(
      `INSERT INTO imports
        (id, project_id, document_id, status, column_mapping, row_count, error_count, warnings, created_at, completed_at)
       VALUES (?, ?, ?, ?, NULL, 0, 0, NULL, ?, NULL)`,
      [id, input.projectId, input.documentId, status, now],
    );
    saveDb();

    return {
      id,
      projectId: input.projectId,
      documentId: input.documentId,
      status,
      columnMapping: null,
      rowCount: 0,
      errorCount: 0,
      warnings: null,
      createdAt: now,
      completedAt: null,
    };
  }

  static async updateStatus(
    importId: string,
    status: ImportStatus,
    extras?: {
      rowCount?: number;
      errorCount?: number;
      warnings?: unknown[];
      columnMapping?: Record<string, string> | null;
      completedAt?: string | null;
    },
  ): Promise<void> {
    const db = await getDb();
    const fields: string[] = ['status = ?'];
    const values: unknown[] = [status];

    if (extras?.rowCount !== undefined) {
      fields.push('row_count = ?');
      values.push(extras.rowCount);
    }
    if (extras?.errorCount !== undefined) {
      fields.push('error_count = ?');
      values.push(extras.errorCount);
    }
    if (extras?.warnings !== undefined) {
      fields.push('warnings = ?');
      values.push(JSON.stringify(extras.warnings));
    }
    if (extras?.columnMapping !== undefined) {
      fields.push('column_mapping = ?');
      values.push(
        extras.columnMapping == null ? null : JSON.stringify(extras.columnMapping),
      );
    }
    if (extras?.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(extras.completedAt);
    }

    values.push(importId);
    db.run(`UPDATE imports SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDb();
  }

  static async findById(importId: string): Promise<ImportRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, document_id as documentId, status,
              column_mapping as columnMapping, row_count as rowCount, error_count as errorCount,
              warnings, created_at as createdAt, completed_at as completedAt
       FROM imports WHERE id = ?`,
    );
    stmt.bind([importId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: String(row.id),
        projectId: String(row.projectId),
        documentId: String(row.documentId),
        status: row.status as ImportStatus,
        columnMapping:
          row.columnMapping != null
            ? (JSON.parse(String(row.columnMapping)) as Record<string, string>)
            : null,
        rowCount: Number(row.rowCount ?? 0),
        errorCount: Number(row.errorCount ?? 0),
        warnings: row.warnings != null ? (JSON.parse(String(row.warnings)) as unknown[]) : null,
        createdAt: String(row.createdAt),
        completedAt: row.completedAt != null ? String(row.completedAt) : null,
      };
    }
    stmt.free();
    return null;
  }

  static async listByProject(projectId: string): Promise<ImportRecord[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, document_id as documentId, status,
              column_mapping as columnMapping, row_count as rowCount, error_count as errorCount,
              warnings, created_at as createdAt, completed_at as completedAt
       FROM imports WHERE project_id = ? ORDER BY created_at DESC`,
    );
    stmt.bind([projectId]);
    const list: ImportRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      list.push({
        id: String(row.id),
        projectId: String(row.projectId),
        documentId: String(row.documentId),
        status: row.status as ImportStatus,
        columnMapping:
          row.columnMapping != null
            ? (JSON.parse(String(row.columnMapping)) as Record<string, string>)
            : null,
        rowCount: Number(row.rowCount ?? 0),
        errorCount: Number(row.errorCount ?? 0),
        warnings: row.warnings != null ? (JSON.parse(String(row.warnings)) as unknown[]) : null,
        createdAt: String(row.createdAt),
        completedAt: row.completedAt != null ? String(row.completedAt) : null,
      });
    }
    stmt.free();
    return list;
  }
}

export class RawRecordRepo {
  /**
   * Bulk-insert raw records for an import. Preserves source_row provenance.
   */
  static async bulkInsert(
    importId: string,
    projectId: string,
    rows: Array<{ sourceRow: number; rawPayload: Record<string, string> }>,
  ): Promise<number> {
    const db = await getDb();
    const now = new Date().toISOString();
    let count = 0;

    for (const row of rows) {
      const id = uuidv4();
      db.run(
        `INSERT INTO raw_records (id, import_id, project_id, source_row, raw_payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, importId, projectId, row.sourceRow, JSON.stringify(row.rawPayload), now],
      );
      count++;
    }
    saveDb();
    return count;
  }

  static async listByImport(importId: string): Promise<RawRecordRow[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, import_id as importId, project_id as projectId, source_row as sourceRow,
              raw_payload as rawPayload, created_at as createdAt
       FROM raw_records WHERE import_id = ? ORDER BY source_row ASC`,
    );
    stmt.bind([importId]);
    const list: RawRecordRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      list.push({
        id: String(row.id),
        importId: String(row.importId),
        projectId: String(row.projectId),
        sourceRow: Number(row.sourceRow),
        rawPayload: JSON.parse(String(row.rawPayload)) as Record<string, string>,
        createdAt: String(row.createdAt),
      });
    }
    stmt.free();
    return list;
  }

  static async countByImport(importId: string): Promise<number> {
    const db = await getDb();
    const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM raw_records WHERE import_id = ?`);
    stmt.bind([importId]);
    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { cnt: number };
      count = Number(row.cnt);
    }
    stmt.free();
    return count;
  }
}
