/**
 * AuditRun + Finding + FindingEvent persistence — Phase 6
 * Spec: docs/02-data-model.md · docs/17-implementation-plan-v1.md § Phase 6
 *
 * - New audit runs never overwrite prior runs.
 * - Findings are scoped to an audit_run_id; current_status is mutable.
 * - FindingEvent history is append-only.
 * - Writes use transactions so a failed persist does not leave a "completed" run.
 */
import { getDb, saveDb } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  AuditRunStatus,
  FindingStatus,
  FindingEventType,
  FindingType,
  FinancialDirection,
  FindingSeverity,
  ConfidenceLevel,
  DashboardBuckets,
  CalculationJson,
} from '../../domain/types.js';
import type { GroupedFinding } from '../../domain/audit/grouping.js';

export interface AuditRunRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  triggeredBy: string;
  status: AuditRunStatus;
  rulesVersion: string;
  asOfDate: string;
  startedAt: string;
  completedAt: string | null;
  summary: DashboardBuckets | null;
}

export interface FindingRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  auditRunId: string;
  rule: string;
  findingType: FindingType;
  financialDirection: FinancialDirection;
  severity: FindingSeverity;
  currentStatus: FindingStatus;
  relatedRecords: Array<{ type: string; id: string }>;
  relatedFindingIds: string[];
  amountSigned: number | null;
  amountAtRisk: number;
  calculation: string;
  calculationJson: CalculationJson;
  explanation: string;
  confidence: ConfidenceLevel;
  isSecondary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FindingEventRecord {
  id: string;
  findingId: string;
  eventType: FindingEventType;
  userId: string | null;
  note: string | null;
  previousStatus: FindingStatus | null;
  newStatus: FindingStatus | null;
  createdAt: string;
}

export class AuditRunRepo {
  /**
   * Create a run in `running` status, then persist findings and mark completed.
   * On failure: marks run `failed` (or rolls back if still in transaction).
   */
  static async createCompletedRun(input: {
    workspaceId: string;
    projectId: string;
    triggeredBy: string;
    rulesVersion: string;
    asOfDate: string;
    findings: GroupedFinding[];
    summary: DashboardBuckets;
  }): Promise<{ run: AuditRunRecord; findings: FindingRecord[] }> {
    const db = await getDb();
    const runId = uuidv4();
    const startedAt = new Date().toISOString();

    // Insert running shell first so a crash mid-way is visible as failed, not success
    db.run(
      `INSERT INTO audit_runs (
        id, project_id, workspace_id, triggered_by, status, rules_version,
        as_of_date, started_at, completed_at, summary
      ) VALUES (?,?,?,?,?,?,?,?,NULL,NULL)`,
      [
        runId,
        input.projectId,
        input.workspaceId,
        input.triggeredBy,
        'running',
        input.rulesVersion,
        input.asOfDate,
        startedAt,
      ],
    );
    saveDb();

    try {
      db.run('BEGIN');

      // Pre-allocate finding IDs so related_finding_ids can resolve
      const findingIds = input.findings.map(() => uuidv4());
      const now = new Date().toISOString();
      const persisted: FindingRecord[] = [];

      for (let i = 0; i < input.findings.length; i++) {
        const f = input.findings[i];
        const id = findingIds[i];
        const relatedIds = f.resolvedRelatedIndices
          .map((idx) => findingIds[idx])
          .filter(Boolean);

        db.run(
          `INSERT INTO findings (
            id, project_id, workspace_id, audit_run_id, rule, finding_type,
            financial_direction, severity, current_status, related_records,
            related_finding_ids, amount_signed, amount_at_risk, calculation,
            calculation_json, explanation, confidence, is_secondary, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            input.projectId,
            input.workspaceId,
            runId,
            f.rule,
            f.findingType,
            f.financialDirection,
            f.severity,
            'OPEN',
            JSON.stringify(f.relatedRecords),
            JSON.stringify(relatedIds),
            f.amountSigned,
            f.amountAtRisk,
            f.calculation,
            JSON.stringify(f.calculationJson),
            f.explanation,
            f.confidence,
            f.isSecondaryInGroup ? 1 : 0,
            now,
            now,
          ],
        );

        const eventId = uuidv4();
        db.run(
          `INSERT INTO finding_events (
            id, finding_id, event_type, user_id, note, previous_status, new_status, created_at
          ) VALUES (?,?,?,?,NULL,NULL,?,?)`,
          [eventId, id, 'created', input.triggeredBy, 'OPEN', now],
        );

        persisted.push({
          id,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          auditRunId: runId,
          rule: f.rule,
          findingType: f.findingType,
          financialDirection: f.financialDirection,
          severity: f.severity,
          currentStatus: 'OPEN',
          relatedRecords: f.relatedRecords,
          relatedFindingIds: relatedIds,
          amountSigned: f.amountSigned,
          amountAtRisk: f.amountAtRisk,
          calculation: f.calculation,
          calculationJson: f.calculationJson,
          explanation: f.explanation,
          confidence: f.confidence,
          isSecondary: f.isSecondaryInGroup,
          createdAt: now,
          updatedAt: now,
        });
      }

      const completedAt = new Date().toISOString();
      db.run(
        `UPDATE audit_runs SET status = ?, completed_at = ?, summary = ? WHERE id = ? AND workspace_id = ?`,
        ['completed', completedAt, JSON.stringify(input.summary), runId, input.workspaceId],
      );

      db.run('COMMIT');
      saveDb();

      return {
        run: {
          id: runId,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          triggeredBy: input.triggeredBy,
          status: 'completed',
          rulesVersion: input.rulesVersion,
          asOfDate: input.asOfDate,
          startedAt,
          completedAt,
          summary: input.summary,
        },
        findings: persisted,
      };
    } catch (err) {
      try {
        db.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      // Mark run failed outside the rolled-back transaction
      try {
        db.run(
          `UPDATE audit_runs SET status = ?, completed_at = ? WHERE id = ? AND workspace_id = ?`,
          ['failed', new Date().toISOString(), runId, input.workspaceId],
        );
        saveDb();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  static async findRun(
    workspaceId: string,
    projectId: string,
    runId: string,
  ): Promise<AuditRunRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, workspace_id as workspaceId, triggered_by as triggeredBy,
              status, rules_version as rulesVersion, as_of_date as asOfDate,
              started_at as startedAt, completed_at as completedAt, summary
       FROM audit_runs
       WHERE id = ? AND workspace_id = ? AND project_id = ?`,
    );
    stmt.bind([runId, workspaceId, projectId]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return {
      id: String(row.id),
      projectId: String(row.projectId),
      workspaceId: String(row.workspaceId),
      triggeredBy: String(row.triggeredBy),
      status: row.status as AuditRunStatus,
      rulesVersion: String(row.rulesVersion),
      asOfDate: String(row.asOfDate),
      startedAt: String(row.startedAt),
      completedAt: row.completedAt != null ? String(row.completedAt) : null,
      summary: row.summary != null ? (JSON.parse(String(row.summary)) as DashboardBuckets) : null,
    };
  }

  static async listRuns(workspaceId: string, projectId: string): Promise<AuditRunRecord[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, workspace_id as workspaceId, triggered_by as triggeredBy,
              status, rules_version as rulesVersion, as_of_date as asOfDate,
              started_at as startedAt, completed_at as completedAt, summary
       FROM audit_runs
       WHERE workspace_id = ? AND project_id = ?
       ORDER BY started_at DESC`,
    );
    stmt.bind([workspaceId, projectId]);
    const list: AuditRunRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      list.push({
        id: String(row.id),
        projectId: String(row.projectId),
        workspaceId: String(row.workspaceId),
        triggeredBy: String(row.triggeredBy),
        status: row.status as AuditRunStatus,
        rulesVersion: String(row.rulesVersion),
        asOfDate: String(row.asOfDate),
        startedAt: String(row.startedAt),
        completedAt: row.completedAt != null ? String(row.completedAt) : null,
        summary: row.summary != null ? (JSON.parse(String(row.summary)) as DashboardBuckets) : null,
      });
    }
    stmt.free();
    return list;
  }

  static async listFindingsForRun(
    workspaceId: string,
    projectId: string,
    runId: string,
  ): Promise<FindingRecord[]> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, project_id as projectId, workspace_id as workspaceId, audit_run_id as auditRunId,
              rule, finding_type as findingType, financial_direction as financialDirection,
              severity, current_status as currentStatus, related_records as relatedRecords,
              related_finding_ids as relatedFindingIds, amount_signed as amountSigned,
              amount_at_risk as amountAtRisk, calculation, calculation_json as calculationJson,
              explanation, confidence, is_secondary as isSecondary,
              created_at as createdAt, updated_at as updatedAt
       FROM findings
       WHERE workspace_id = ? AND project_id = ? AND audit_run_id = ?
       ORDER BY rule ASC, amount_at_risk DESC`,
    );
    stmt.bind([workspaceId, projectId, runId]);
    const list: FindingRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      list.push({
        id: String(row.id),
        projectId: String(row.projectId),
        workspaceId: String(row.workspaceId),
        auditRunId: String(row.auditRunId),
        rule: String(row.rule),
        findingType: row.findingType as FindingType,
        financialDirection: row.financialDirection as FinancialDirection,
        severity: row.severity as FindingSeverity,
        currentStatus: row.currentStatus as FindingStatus,
        relatedRecords: JSON.parse(String(row.relatedRecords ?? '[]')),
        relatedFindingIds: JSON.parse(String(row.relatedFindingIds ?? '[]')),
        amountSigned: row.amountSigned != null ? Number(row.amountSigned) : null,
        amountAtRisk: Number(row.amountAtRisk),
        calculation: String(row.calculation),
        calculationJson: JSON.parse(String(row.calculationJson ?? '{}')),
        explanation: String(row.explanation),
        confidence: row.confidence as ConfidenceLevel,
        isSecondary: Boolean(row.isSecondary),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
      });
    }
    stmt.free();
    return list;
  }

  static async listEventsForFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<FindingEventRecord[]> {
    const db = await getDb();
    // Ensure finding belongs to workspace
    const check = db.prepare(
      `SELECT id FROM findings WHERE id = ? AND workspace_id = ?`,
    );
    check.bind([findingId, workspaceId]);
    if (!check.step()) {
      check.free();
      return [];
    }
    check.free();

    const stmt = db.prepare(
      `SELECT id, finding_id as findingId, event_type as eventType, user_id as userId,
              note, previous_status as previousStatus, new_status as newStatus, created_at as createdAt
       FROM finding_events WHERE finding_id = ? ORDER BY created_at ASC`,
    );
    stmt.bind([findingId]);
    const list: FindingEventRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      list.push({
        id: String(row.id),
        findingId: String(row.findingId),
        eventType: row.eventType as FindingEventType,
        userId: row.userId != null ? String(row.userId) : null,
        note: row.note != null ? String(row.note) : null,
        previousStatus: row.previousStatus != null ? (row.previousStatus as FindingStatus) : null,
        newStatus: row.newStatus != null ? (row.newStatus as FindingStatus) : null,
        createdAt: String(row.createdAt),
      });
    }
    stmt.free();
    return list;
  }

  /**
   * Update finding status and append an immutable event. Never deletes history.
   */
  static async updateFindingStatus(input: {
    workspaceId: string;
    projectId: string;
    findingId: string;
    userId: string;
    newStatus: FindingStatus;
    note?: string;
  }): Promise<FindingRecord | null> {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, audit_run_id as auditRunId, current_status as currentStatus
       FROM findings
       WHERE id = ? AND workspace_id = ? AND project_id = ?`,
    );
    stmt.bind([input.findingId, input.workspaceId, input.projectId]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject() as {
      id: string;
      auditRunId: string;
      currentStatus: FindingStatus;
    };
    stmt.free();
    const previous = row.currentStatus;
    const now = new Date().toISOString();

    try {
      db.run('BEGIN');
      db.run(
        `UPDATE findings SET current_status = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND project_id = ?`,
        [input.newStatus, now, input.findingId, input.workspaceId, input.projectId],
      );
      const eventType: FindingEventType =
        input.newStatus === 'REVIEWED'
          ? 'reviewed'
          : input.newStatus === 'ACCEPTED'
            ? 'accepted'
            : input.newStatus === 'DISMISSED'
              ? 'dismissed'
              : input.newStatus === 'RESOLVED'
                ? 'resolved'
                : 'commented';
      db.run(
        `INSERT INTO finding_events (
          id, finding_id, event_type, user_id, note, previous_status, new_status, created_at
        ) VALUES (?,?,?,?,?,?,?,?)`,
        [
          uuidv4(),
          input.findingId,
          eventType,
          input.userId,
          input.note ?? null,
          previous,
          input.newStatus,
          now,
        ],
      );
      db.run('COMMIT');
      saveDb();
    } catch (err) {
      try {
        db.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }

    const findings = await this.listFindingsForRun(
      input.workspaceId,
      input.projectId,
      row.auditRunId,
    );
    return findings.find((f) => f.id === input.findingId) ?? null;
  }
}
