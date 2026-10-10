/**
 * Phase 6 — Audit run persistence + isolation tests
 * Spec: docs/17-implementation-plan-v1.md § Phase 6
 *
 * Execution deferred if deps unavailable.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { resetDbForTests } from '../../src/db/db.js';
import { AuthService } from '../../src/domain/auth/authService.js';
import { ProjectRepo } from '../../src/db/repos/projectRepo.js';
import { AuditService } from '../../src/domain/audit/auditService.js';
import { AuditRunRepo } from '../../src/db/repos/auditRunRepo.js';
import { getDb } from '../../src/db/db.js';
import { v4 as uuidv4 } from 'uuid';

describe('AuditService.runAudit', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('rejects invalid as_of_date', async () => {
    const reg = await AuthService.register({
      email: 'audit1@example.com',
      name: 'A',
      password: 'password123',
      workspaceName: 'WS',
    });
    const project = await ProjectRepo.create(reg.workspace.id, 'P');
    await expect(
      AuditService.runAudit({
        workspaceId: reg.workspace.id,
        projectId: project.id,
        userId: reg.user.id,
        asOfDate: 'not-a-date',
      }),
    ).rejects.toThrow(/as_of_date/);
  });

  test('rejects cross-workspace project access', async () => {
    const a = await AuthService.register({
      email: 'audit-a@example.com',
      name: 'A',
      password: 'password123',
      workspaceName: 'WS-A',
    });
    const b = await AuthService.register({
      email: 'audit-b@example.com',
      name: 'B',
      password: 'password123',
      workspaceName: 'WS-B',
    });
    const projectB = await ProjectRepo.create(b.workspace.id, 'PB');
    await expect(
      AuditService.runAudit({
        workspaceId: b.workspace.id,
        projectId: projectB.id,
        userId: a.user.id,
        asOfDate: '2025-08-15',
      }),
    ).rejects.toThrow(/Not a member/);
  });

  test('creates completed run with findings and created events; second run is separate', async () => {
    const reg = await AuthService.register({
      email: 'audit2@example.com',
      name: 'A',
      password: 'password123',
      workspaceName: 'WS',
    });
    const project = await ProjectRepo.create(reg.workspace.id, 'P');

    const first = await AuditService.runAudit({
      workspaceId: reg.workspace.id,
      projectId: project.id,
      userId: reg.user.id,
      asOfDate: '2025-08-15',
    });
    expect(first.run.status).toBe('completed');
    expect(first.run.asOfDate).toBe('2025-08-15');
    expect(first.run.summary).toBeDefined();
    // Empty project → zero or few findings; structure must hold
    expect(Array.isArray(first.findings)).toBe(true);
    expect(first.run.summary).toHaveProperty('potentialUnderbilling');
    expect(first.run.summary).toHaveProperty('potentialOverbilling');
    expect(first.run.summary).toHaveProperty('evidenceDisputeExposure');

    const second = await AuditService.runAudit({
      workspaceId: reg.workspace.id,
      projectId: project.id,
      userId: reg.user.id,
      asOfDate: '2025-08-15',
    });
    expect(second.run.id).not.toBe(first.run.id);

    const runs = await AuditService.listRuns(reg.workspace.id, project.id, reg.user.id);
    expect(runs.length).toBeGreaterThanOrEqual(2);

    // First run still retrievable
    const reloaded = await AuditService.getRun(
      reg.workspace.id,
      project.id,
      first.run.id,
      reg.user.id,
    );
    expect(reloaded.run.id).toBe(first.run.id);
  });

  test('getRun for another workspace returns not found', async () => {
    const a = await AuthService.register({
      email: 'audit3a@example.com',
      name: 'A',
      password: 'password123',
      workspaceName: 'WS-A',
    });
    const b = await AuthService.register({
      email: 'audit3b@example.com',
      name: 'B',
      password: 'password123',
      workspaceName: 'WS-B',
    });
    const projectA = await ProjectRepo.create(a.workspace.id, 'PA');
    const run = await AuditService.runAudit({
      workspaceId: a.workspace.id,
      projectId: projectA.id,
      userId: a.user.id,
      asOfDate: '2025-08-15',
    });
    await expect(
      AuditService.getRun(b.workspace.id, projectA.id, run.run.id, b.user.id),
    ).rejects.toThrow();
  });
});

describe('Evidence link workspace isolation', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('evidence links from workspace A do not appear in workspace B snapshot', async () => {
    const { buildAuditSnapshot } = await import('../../src/domain/matching/snapshotBuilder.js');
    const db = await getDb();

    const a = await AuthService.register({
      email: 'ev-a@example.com',
      name: 'A',
      password: 'password123',
      workspaceName: 'WS-A',
    });
    const b = await AuthService.register({
      email: 'ev-b@example.com',
      name: 'B',
      password: 'password123',
      workspaceName: 'WS-B',
    });
    const projectA = await ProjectRepo.create(a.workspace.id, 'PA');
    const projectB = await ProjectRepo.create(b.workspace.id, 'PB');

    const now = new Date().toISOString();
    // Evidence + link only in workspace A
    const evidenceUuid = uuidv4();
    db.run(
      `INSERT INTO evidence (
        id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page,
        raw_values, evidence_id, date, type, description, file_reference, page_reference,
        timestamp, confidence, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        evidenceUuid,
        projectA.id,
        a.workspace.id,
        'doc-a',
        'imp-a',
        '2',
        '{}',
        'EV-SECRET',
        '2025-03-20',
        'approval',
        'secret',
        'file.pdf',
        '1',
        null,
        'HIGH',
        now,
        now,
      ],
    );
    db.run(
      `INSERT INTO evidence_links (id, workspace_id, project_id, evidence_id, entity_type, entity_id, relationship, confidence)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), a.workspace.id, projectA.id, 'EV-SECRET', 'change_order', 'CO-001', 'supports', 'HIGH'],
    );

    const snapB = await buildAuditSnapshot(b.workspace.id, projectB.id, '2025-08-15');
    expect(snapB.evidenceRecords.some((e) => e.evidenceId === 'EV-SECRET')).toBe(false);
    expect(snapB.evidenceLinks.some((l) => l.evidenceId === 'EV-SECRET')).toBe(false);

    const snapA = await buildAuditSnapshot(a.workspace.id, projectA.id, '2025-08-15');
    expect(snapA.evidenceRecords.some((e) => e.evidenceId === 'EV-SECRET')).toBe(true);
    expect(snapA.evidenceLinks.some((l) => l.evidenceId === 'EV-SECRET')).toBe(true);
  });
});

describe('Finding status events', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('status update appends event and preserves prior status in history', async () => {
    const reg = await AuthService.register({
      email: 'status@example.com',
      name: 'S',
      password: 'password123',
      workspaceName: 'WS',
    });
    const project = await ProjectRepo.create(reg.workspace.id, 'P');
    // Manually insert a finding via a completed empty run
    const { run, findings } = await AuditService.runAudit({
      workspaceId: reg.workspace.id,
      projectId: project.id,
      userId: reg.user.id,
      asOfDate: '2025-08-15',
    });
    // If no findings, seed one for lifecycle test
    let findingId = findings[0]?.id;
    if (!findingId) {
      const db = await getDb();
      findingId = uuidv4();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO findings (
          id, project_id, workspace_id, audit_run_id, rule, finding_type, financial_direction,
          severity, current_status, related_records, related_finding_ids, amount_signed,
          amount_at_risk, calculation, calculation_json, explanation, confidence, is_secondary,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          findingId,
          project.id,
          reg.workspace.id,
          run.id,
          'RULE_001',
          'REVENUE_AT_RISK',
          'UNDERBILLED',
          'HIGH',
          'OPEN',
          '[]',
          '[]',
          100,
          100,
          'test',
          '{}',
          'test',
          'HIGH',
          0,
          now,
          now,
        ],
      );
      db.run(
        `INSERT INTO finding_events (id, finding_id, event_type, user_id, note, previous_status, new_status, created_at)
         VALUES (?,?,?,?,NULL,NULL,?,?)`,
        [uuidv4(), findingId, 'created', reg.user.id, 'OPEN', now],
      );
    }

    const updated = await AuditService.updateFindingStatus({
      workspaceId: reg.workspace.id,
      projectId: project.id,
      findingId,
      userId: reg.user.id,
      newStatus: 'DISMISSED',
      note: 'not material',
    });
    expect(updated.currentStatus).toBe('DISMISSED');

    const events = await AuditRunRepo.listEventsForFinding(reg.workspace.id, findingId);
    expect(events.some((e) => e.eventType === 'created')).toBe(true);
    expect(events.some((e) => e.eventType === 'dismissed' && e.previousStatus === 'OPEN')).toBe(
      true,
    );
  });
});
