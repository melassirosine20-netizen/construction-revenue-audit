/**
 * AuditService — run engine + persist results (Phase 6)
 * Spec: docs/17-implementation-plan-v1.md § Phase 6
 *
 * Does not invent monetary findings. Uses pure runAuditEngine only.
 */
import { AuthService } from '../auth/authService.js';
import { ProjectRepo } from '../../db/repos/projectRepo.js';
import { AuditRunRepo, type AuditRunRecord, type FindingRecord } from '../../db/repos/auditRunRepo.js';
import { buildAuditSnapshot } from '../matching/snapshotBuilder.js';
import { runAuditEngine, RULES_VERSION } from './engine.js';
import type { FindingStatus } from '../types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AuditService {
  /**
   * Create a new audit run for a workspace-scoped project.
   * Prior runs are left intact (append-only history of runs).
   */
  static async runAudit(input: {
    workspaceId: string;
    projectId: string;
    userId: string;
    asOfDate: string;
  }): Promise<{ run: AuditRunRecord; findings: FindingRecord[] }> {
    await AuthService.requireRole(input.workspaceId, input.userId, 'member');

    const project = await ProjectRepo.findById(input.workspaceId, input.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    if (!ISO_DATE.test(input.asOfDate)) {
      throw new Error('as_of_date must be an ISO date (YYYY-MM-DD)');
    }
    const d = new Date(input.asOfDate + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) {
      throw new Error('as_of_date is not a valid calendar date');
    }

    const snapshot = await buildAuditSnapshot(
      input.workspaceId,
      input.projectId,
      input.asOfDate,
    );

    const result = runAuditEngine(snapshot);

    return AuditRunRepo.createCompletedRun({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      triggeredBy: input.userId,
      rulesVersion: RULES_VERSION,
      asOfDate: input.asOfDate,
      findings: result.findings,
      summary: result.dashboardBuckets,
    });
  }

  static async getRun(
    workspaceId: string,
    projectId: string,
    runId: string,
    userId: string,
  ): Promise<{ run: AuditRunRecord; findings: FindingRecord[] }> {
    await AuthService.requireRole(workspaceId, userId, 'viewer');
    const project = await ProjectRepo.findById(workspaceId, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const run = await AuditRunRepo.findRun(workspaceId, projectId, runId);
    if (!run) {
      throw new Error('Audit run not found');
    }
    const findings = await AuditRunRepo.listFindingsForRun(workspaceId, projectId, runId);
    return { run, findings };
  }

  static async listRuns(workspaceId: string, projectId: string, userId: string) {
    await AuthService.requireRole(workspaceId, userId, 'viewer');
    const project = await ProjectRepo.findById(workspaceId, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return AuditRunRepo.listRuns(workspaceId, projectId);
  }

  static async updateFindingStatus(input: {
    workspaceId: string;
    projectId: string;
    findingId: string;
    userId: string;
    newStatus: FindingStatus;
    note?: string;
  }): Promise<FindingRecord> {
    await AuthService.requireRole(input.workspaceId, input.userId, 'member');
    const project = await ProjectRepo.findById(input.workspaceId, input.projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const allowed: FindingStatus[] = ['OPEN', 'REVIEWED', 'ACCEPTED', 'DISMISSED', 'RESOLVED'];
    if (!allowed.includes(input.newStatus)) {
      throw new Error(`Invalid status: ${input.newStatus}`);
    }
    const updated = await AuditRunRepo.updateFindingStatus(input);
    if (!updated) {
      throw new Error('Finding not found');
    }
    return updated;
  }
}
