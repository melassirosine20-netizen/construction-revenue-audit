/**
 * Cross-import business-key collision detection — safety layer
 * Spec: docs/02-data-model.md (provenance preserved; no silent merge)
 *
 * Detects when the same business key appears under different source_import_id
 * values within one project. Does NOT delete or merge — callers surface candidates.
 */
import { getDb } from '../../db/db.js';

export interface DuplicateCandidate {
  entityKind: string;
  businessKey: string;
  keyColumn: string;
  importIds: string[];
  rowCount: number;
}

const CHECKS: Array<{ kind: string; table: string; keyColumn: string }> = [
  { kind: 'change_order', table: 'change_orders', keyColumn: 'change_order_id' },
  // Billing lines: composite business key (invoice + line)
  { kind: 'billing', table: 'billing_items', keyColumn: "billing_id || '::' || line_id" },
  { kind: 'tm_ticket', table: 'tm_tickets', keyColumn: 'ticket_id' },
  { kind: 'contract_sov', table: 'contract_sov_lines', keyColumn: "contract_id || '::' || line_id" },
  { kind: 'rate_table', table: 'rate_table', keyColumn: 'rate_id' },
  { kind: 'evidence', table: 'evidence', keyColumn: 'evidence_id' },
];

/**
 * Find business keys that appear in more than one import for a project.
 * Scoped strictly to workspace_id + project_id.
 */
export async function findCrossImportDuplicates(
  workspaceId: string,
  projectId: string,
): Promise<DuplicateCandidate[]> {
  const db = await getDb();
  const results: DuplicateCandidate[] = [];

  for (const { kind, table, keyColumn } of CHECKS) {
    const stmt = db.prepare(
      `SELECT ${keyColumn} as biz_key,
              COUNT(DISTINCT source_import_id) as import_count,
              COUNT(*) as row_count,
              GROUP_CONCAT(DISTINCT source_import_id) as import_ids
       FROM ${table}
       WHERE workspace_id = ? AND project_id = ?
       GROUP BY ${keyColumn}
       HAVING COUNT(DISTINCT source_import_id) > 1`,
    );
    stmt.bind([workspaceId, projectId]);
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const importIds = String(row.import_ids ?? '')
        .split(',')
        .filter(Boolean);
      results.push({
        entityKind: kind,
        businessKey: String(row.biz_key),
        keyColumn,
        importIds,
        rowCount: Number(row.row_count),
      });
    }
    stmt.free();
  }

  return results;
}
