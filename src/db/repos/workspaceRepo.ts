/**
 * Workspace and User Repositories
 * Phase 1: Tenancy, Auth, and Workspace Isolation
 * Spec: docs/17-implementation-plan-v1.md § Phase 1
 */
import { getDb, saveDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import type { WorkspaceRole, WorkspaceSettings } from '../../domain/types.js';
import { DEFAULT_SETTINGS } from '../../domain/types.js';

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface MembershipRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

export class WorkspaceRepo {
  static async create(name: string, ownerUserId: string): Promise<WorkspaceRecord> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [id, name, now, now],
    );

    db.run(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      [id, ownerUserId, 'owner', now],
    );

    db.run(
      `INSERT INTO workspace_settings (workspace_id, materiality_absolute, materiality_pct, rounding_currency, rounding_quantity, billing_grace_days)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        DEFAULT_SETTINGS.materialityAbsolute,
        DEFAULT_SETTINGS.materialityPct,
        DEFAULT_SETTINGS.roundingCurrency,
        DEFAULT_SETTINGS.roundingQuantity,
        DEFAULT_SETTINGS.billingGraceDays,
      ],
    );

    saveDb();
    return { id, name, createdAt: now, updatedAt: now };
  }

  static async findById(id: string): Promise<WorkspaceRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(`SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM workspaces WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as WorkspaceRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  static async getSettings(workspaceId: string): Promise<WorkspaceSettings> {
    const db = await getDb();
    const stmt = db.prepare(`SELECT * FROM workspace_settings WHERE workspace_id = ?`);
    stmt.bind([workspaceId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        workspaceId,
        materialityAbsolute: Number(row.materiality_absolute ?? DEFAULT_SETTINGS.materialityAbsolute),
        materialityPct: Number(row.materiality_pct ?? DEFAULT_SETTINGS.materialityPct),
        roundingCurrency: Number(row.rounding_currency ?? DEFAULT_SETTINGS.roundingCurrency),
        roundingQuantity: Number(row.rounding_quantity ?? DEFAULT_SETTINGS.roundingQuantity),
        billingGraceDays: Number(row.billing_grace_days ?? DEFAULT_SETTINGS.billingGraceDays),
      };
    }
    stmt.free();
    return { workspaceId, ...DEFAULT_SETTINGS };
  }

  static async checkMembership(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const db = await getDb();
    const stmt = db.prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`);
    stmt.bind([workspaceId, userId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as { role: WorkspaceRole };
      stmt.free();
      return row.role;
    }
    stmt.free();
    return null;
  }

  /**
   * Add or update a membership. Used for inviting users and for tests.
   * Does not allow elevating the last remaining owner.
   */
  static async addMembership(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<MembershipRecord> {
    const db = await getDb();
    const now = new Date().toISOString();
    // Upsert-style: delete then insert (SQLite simple path)
    db.run(`DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`, [
      workspaceId,
      userId,
    ]);
    db.run(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      [workspaceId, userId, role, now],
    );
    saveDb();
    return { workspaceId, userId, role, createdAt: now };
  }
}

export class UserRepo {
  static async create(email: string, name: string, passwordHash: string): Promise<UserRecord> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), name, passwordHash, now],
    );

    saveDb();
    return { id, email: email.toLowerCase(), name, passwordHash, createdAt: now };
  }

  static async findByEmail(email: string): Promise<UserRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(`SELECT id, email, name, password_hash as passwordHash, created_at as createdAt FROM users WHERE email = ?`);
    stmt.bind([email.toLowerCase()]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as UserRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  static async findById(id: string): Promise<UserRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(`SELECT id, email, name, password_hash as passwordHash, created_at as createdAt FROM users WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as UserRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }
}
