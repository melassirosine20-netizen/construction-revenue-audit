/**
 * Phase 1 — Workspace isolation, RBAC & security tests
 * Spec: docs/17-implementation-plan-v1.md § Phase 1 acceptance
 * Spec: docs/09-security.md — tenant isolation, RBAC
 *
 * Uses existing WorkspaceRepo / UserRepo / ProjectRepo + AuthService.
 * Does NOT touch AuditEngine or financial logic.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { resetDbForTests } from '../../src/db/db.js';
import { UserRepo, WorkspaceRepo } from '../../src/db/repos/workspaceRepo.js';
import { ProjectRepo } from '../../src/db/repos/projectRepo.js';
import { AuthService } from '../../src/domain/auth/authService.js';
import { hashPassword, verifyPassword } from '../../src/domain/auth/password.js';

describe('Password hashing', () => {
  test('hash and verify round-trip', async () => {
    const hash = await hashPassword('securePass1');
    expect(hash).toContain(':');
    expect(await verifyPassword('securePass1', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  test('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/);
  });

  test('different salts produce different hashes', async () => {
    const a = await hashPassword('samePassword1');
    const b = await hashPassword('samePassword1');
    expect(a).not.toBe(b);
    expect(await verifyPassword('samePassword1', a)).toBe(true);
    expect(await verifyPassword('samePassword1', b)).toBe(true);
  });

  test('malformed stored hash returns false', async () => {
    expect(await verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('AuthService register + login', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('register creates user + workspace with owner role', async () => {
    const result = await AuthService.register({
      email: 'alice@example.com',
      name: 'Alice',
      password: 'password123',
      workspaceName: 'Alice Co',
    });
    expect(result.user.email).toBe('alice@example.com');
    expect(result.workspace.name).toBe('Alice Co');
    expect(result.role).toBe('owner');
    // passwordHash must never be returned
    expect((result.user as { passwordHash?: string }).passwordHash).toBeUndefined();

    const role = await WorkspaceRepo.checkMembership(result.workspace.id, result.user.id);
    expect(role).toBe('owner');
  });

  test('register normalizes email to lowercase', async () => {
    const result = await AuthService.register({
      email: 'Alice@Example.COM',
      name: 'Alice',
      password: 'password123',
      workspaceName: 'Alice Co',
    });
    expect(result.user.email).toBe('alice@example.com');
  });

  test('register rejects duplicate email', async () => {
    await AuthService.register({
      email: 'bob@example.com',
      name: 'Bob',
      password: 'password123',
      workspaceName: 'Bob Co',
    });
    await expect(
      AuthService.register({
        email: 'bob@example.com',
        name: 'Bob 2',
        password: 'password123',
        workspaceName: 'Other',
      }),
    ).rejects.toThrow(/already registered/);
  });

  test('register rejects invalid email / missing fields', async () => {
    await expect(
      AuthService.register({
        email: 'not-an-email',
        name: 'X',
        password: 'password123',
        workspaceName: 'W',
      }),
    ).rejects.toThrow(/Valid email/);
    await expect(
      AuthService.register({
        email: 'ok@example.com',
        name: '',
        password: 'password123',
        workspaceName: 'W',
      }),
    ).rejects.toThrow(/Name is required/);
  });

  test('login succeeds with correct credentials', async () => {
    await AuthService.register({
      email: 'carol@example.com',
      name: 'Carol',
      password: 'password123',
      workspaceName: 'Carol Co',
    });
    const login = await AuthService.login('carol@example.com', 'password123');
    expect(login.user.email).toBe('carol@example.com');
    expect((login.user as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  test('login fails with wrong password (generic error)', async () => {
    await AuthService.register({
      email: 'dave@example.com',
      name: 'Dave',
      password: 'password123',
      workspaceName: 'Dave Co',
    });
    await expect(AuthService.login('dave@example.com', 'wrong')).rejects.toThrow(
      /Invalid email or password/,
    );
  });

  test('login fails for unknown email (same generic error)', async () => {
    await expect(AuthService.login('nobody@example.com', 'password123')).rejects.toThrow(
      /Invalid email or password/,
    );
  });
});

describe('Cross-workspace isolation', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('user A cannot read user B project via workspace-scoped query', async () => {
    const a = await AuthService.register({
      email: 'a@example.com',
      name: 'User A',
      password: 'password123',
      workspaceName: 'Workspace A',
    });
    const b = await AuthService.register({
      email: 'b@example.com',
      name: 'User B',
      password: 'password123',
      workspaceName: 'Workspace B',
    });

    const projectB = await ProjectRepo.create(b.workspace.id, 'Secret Project B');

    // Query from A's workspace must not return B's project
    const fromA = await ProjectRepo.findById(a.workspace.id, projectB.id);
    expect(fromA).toBeNull();

    // Correct workspace sees it
    const fromB = await ProjectRepo.findById(b.workspace.id, projectB.id);
    expect(fromB).not.toBeNull();
    expect(fromB!.name).toBe('Secret Project B');
  });

  test('listByWorkspace only returns projects of that workspace', async () => {
    const a = await AuthService.register({
      email: 'a2@example.com',
      name: 'User A2',
      password: 'password123',
      workspaceName: 'WS-A',
    });
    const b = await AuthService.register({
      email: 'b2@example.com',
      name: 'User B2',
      password: 'password123',
      workspaceName: 'WS-B',
    });

    await ProjectRepo.create(a.workspace.id, 'Proj A1');
    await ProjectRepo.create(a.workspace.id, 'Proj A2');
    await ProjectRepo.create(b.workspace.id, 'Proj B1');

    const listA = await ProjectRepo.listByWorkspace(a.workspace.id);
    const listB = await ProjectRepo.listByWorkspace(b.workspace.id);

    expect(listA).toHaveLength(2);
    expect(listA.every((p) => p.workspaceId === a.workspace.id)).toBe(true);
    expect(listB).toHaveLength(1);
    expect(listB[0].name).toBe('Proj B1');
  });

  test('requireRole denies non-member (cross-workspace access attempt)', async () => {
    const a = await AuthService.register({
      email: 'a3@example.com',
      name: 'User A3',
      password: 'password123',
      workspaceName: 'WS-A3',
    });
    const b = await AuthService.register({
      email: 'b3@example.com',
      name: 'User B3',
      password: 'password123',
      workspaceName: 'WS-B3',
    });

    await expect(AuthService.requireRole(a.workspace.id, b.user.id, 'viewer')).rejects.toThrow(
      /Not a member/,
    );
  });

  test('parameter tampering: correct projectId but wrong workspaceId yields null', async () => {
    const a = await AuthService.register({
      email: 'a4@example.com',
      name: 'User A4',
      password: 'password123',
      workspaceName: 'WS-A4',
    });
    const b = await AuthService.register({
      email: 'b4@example.com',
      name: 'User B4',
      password: 'password123',
      workspaceName: 'WS-B4',
    });
    const projectB = await ProjectRepo.create(b.workspace.id, 'B Project');

    // Attacker supplies B's projectId but A's workspaceId
    const leaked = await ProjectRepo.findById(a.workspace.id, projectB.id);
    expect(leaked).toBeNull();
  });
});

describe('RBAC role hierarchy', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('owner satisfies admin/member/viewer requirements', async () => {
    const owner = await AuthService.register({
      email: 'owner@example.com',
      name: 'Owner',
      password: 'password123',
      workspaceName: 'Owned',
    });
    expect(await AuthService.requireRole(owner.workspace.id, owner.user.id, 'viewer')).toBe(
      'owner',
    );
    expect(await AuthService.requireRole(owner.workspace.id, owner.user.id, 'member')).toBe(
      'owner',
    );
    expect(await AuthService.requireRole(owner.workspace.id, owner.user.id, 'admin')).toBe(
      'owner',
    );
    expect(await AuthService.requireRole(owner.workspace.id, owner.user.id, 'owner')).toBe(
      'owner',
    );
  });

  test('viewer cannot satisfy member (write) requirement', async () => {
    const owner = await AuthService.register({
      email: 'owner2@example.com',
      name: 'Owner2',
      password: 'password123',
      workspaceName: 'Owned2',
    });
    // Create a second user and add as viewer
    const viewerUser = await UserRepo.create(
      'viewer@example.com',
      'Viewer',
      await hashPassword('password123'),
    );
    await WorkspaceRepo.addMembership(owner.workspace.id, viewerUser.id, 'viewer');

    expect(await AuthService.getRole(owner.workspace.id, viewerUser.id)).toBe('viewer');
    await expect(
      AuthService.requireRole(owner.workspace.id, viewerUser.id, 'member'),
    ).rejects.toThrow(/Requires role member/);
    // viewer can still satisfy viewer
    expect(await AuthService.requireRole(owner.workspace.id, viewerUser.id, 'viewer')).toBe(
      'viewer',
    );
  });

  test('member can write but not admin', async () => {
    const owner = await AuthService.register({
      email: 'owner3@example.com',
      name: 'Owner3',
      password: 'password123',
      workspaceName: 'Owned3',
    });
    const memberUser = await UserRepo.create(
      'member@example.com',
      'Member',
      await hashPassword('password123'),
    );
    await WorkspaceRepo.addMembership(owner.workspace.id, memberUser.id, 'member');

    expect(await AuthService.requireRole(owner.workspace.id, memberUser.id, 'member')).toBe(
      'member',
    );
    await expect(
      AuthService.requireRole(owner.workspace.id, memberUser.id, 'admin'),
    ).rejects.toThrow(/Requires role admin/);
  });
});
