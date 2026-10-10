/**
 * Match persistence — Phase 4
 * Spec: docs/03-detection-rules.md · matches table
 *
 * Replacing matches for a project is intentional: matching is recomputed from
 * current normalized data (idempotent project-level refresh).
 */
import { getDb, saveDb } from '../db.js';
import type { Match, MatchMethod } from '../../domain/types.js';

export class MatchRepo {
  /**
   * Replace all matches for a workspace+project with the provided set (transactional).
   */
  static async replaceForProject(
    workspaceId: string,
    projectId: string,
    matches: Match[],
  ): Promise<number> {
    const db = await getDb();
    try {
      db.run('BEGIN');
      db.run(`DELETE FROM matches WHERE workspace_id = ? AND project_id = ?`, [
        workspaceId,
        projectId,
      ]);
      for (const m of matches) {
        db.run(
          `INSERT INTO matches (
            id, project_id, workspace_id, source_type, source_id, target_type, target_id,
            match_method, match_confidence, user_confirmed, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            m.matchId,
            projectId,
            workspaceId,
            m.sourceType,
            m.sourceId,
            m.targetType,
            m.targetId,
            m.matchMethod,
            m.matchConfidence,
            m.userConfirmed ? 1 : 0,
            m.createdAt,
          ],
        );
      }
      db.run('COMMIT');
      saveDb();
      return matches.length;
    } catch (err) {
      try {
        db.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  static async listByProject(workspaceId: string, projectId: string): Promise<Match[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id as matchId, project_id as projectId, source_type as sourceType,
              source_id as sourceId, target_type as targetType, target_id as targetId,
              match_method as matchMethod, match_confidence as matchConfidence,
              user_confirmed as userConfirmed, created_at as createdAt
       FROM matches WHERE workspace_id = ? AND project_id = ?
       ORDER BY source_id ASC`,
    );
    stmt.bind([workspaceId, projectId]);
    const list: Match[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      list.push({
        matchId: String(row.matchId),
        projectId: String(row.projectId),
        sourceType: String(row.sourceType),
        sourceId: String(row.sourceId),
        targetType: String(row.targetType),
        targetId: String(row.targetId),
        matchMethod: row.matchMethod as MatchMethod,
        matchConfidence: Number(row.matchConfidence),
        userConfirmed: Boolean(row.userConfirmed),
        createdAt: String(row.createdAt),
      });
    }
    stmt.free();
    return list;
  }
}
