/**
 * Project Repository with Workspace Isolation
 * Spec: docs/02-data-model.md § Project
 * Spec: docs/17-implementation-plan-v1.md § Phase 1
 */
import { getDb, saveDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import type { ProjectStatus } from '../../domain/types.js';

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  externalProjectNumber: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export class ProjectRepo {
  static async create(
    workspaceId: string,
    name: string,
    externalProjectNumber?: string,
  ): Promise<ProjectRecord> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO projects (id, workspace_id, name, external_project_number, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [id, workspaceId, name, externalProjectNumber ?? null, now, now],
    );

    saveDb();
    return {
      id,
      workspaceId,
      name,
      externalProjectNumber: externalProjectNumber ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  }

  static async findById(workspaceId: string, projectId: string): Promise<ProjectRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, workspace_id as workspaceId, name, external_project_number as externalProjectNumber,
              status, created_at as createdAt, updated_at as updatedAt
       FROM projects WHERE id = ? AND workspace_id = ?`,
    );
    stmt.bind([projectId, workspaceId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as ProjectRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  static async listByWorkspace(workspaceId: string): Promise<ProjectRecord[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, workspace_id as workspaceId, name, external_project_number as externalProjectNumber,
              status, created_at as createdAt, updated_at as updatedAt
       FROM projects WHERE workspace_id = ? ORDER BY created_at DESC`,
    );
    stmt.bind([workspaceId]);
    const list: ProjectRecord[] = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject() as unknown as ProjectRecord);
    }
    stmt.free();
    return list;
  }
}
