/**
 * AuthService — Phase 1
 * Composes existing UserRepo + WorkspaceRepo. No duplicate DB layer.
 * Spec: docs/17-implementation-plan-v1.md § Phase 1; docs/09-security.md
 */
import { UserRepo, WorkspaceRepo, type UserRecord, type WorkspaceRecord } from '../../db/repos/workspaceRepo.js';
import type { WorkspaceRole } from '../types.js';
import { hashPassword, verifyPassword } from './password.js';

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
  workspaceName: string;
}

export interface RegisterResult {
  user: Omit<UserRecord, 'passwordHash'>;
  workspace: WorkspaceRecord;
  role: WorkspaceRole;
}

export interface LoginResult {
  user: Omit<UserRecord, 'passwordHash'>;
}

function stripHash(u: UserRecord): Omit<UserRecord, 'passwordHash'> {
  const { passwordHash: _, ...rest } = u;
  return rest;
}

export class AuthService {
  /**
   * Register a new user and create their first workspace (role = owner).
   * Email is lower-cased and must be unique.
   */
  static async register(input: RegisterInput): Promise<RegisterResult> {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new Error('Valid email is required');
    }
    if (!input.name?.trim()) {
      throw new Error('Name is required');
    }
    if (!input.workspaceName?.trim()) {
      throw new Error('Workspace name is required');
    }

    const existing = await UserRepo.findByEmail(email);
    if (existing) {
      throw new Error('Email already registered');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await UserRepo.create(email, input.name.trim(), passwordHash);
    const workspace = await WorkspaceRepo.create(input.workspaceName.trim(), user.id);

    return {
      user: stripHash(user),
      workspace,
      role: 'owner',
    };
  }

  /**
   * Authenticate by email + password. Returns user without hash.
   */
  static async login(email: string, password: string): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    const user = await UserRepo.findByEmail(normalized);
    if (!user) {
      throw new Error('Invalid email or password');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new Error('Invalid email or password');
    }
    return { user: stripHash(user) };
  }

  /**
   * Resolve the caller's role in a workspace. Returns null if not a member.
   */
  static async getRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    return WorkspaceRepo.checkMembership(workspaceId, userId);
  }

  /**
   * Require at least the given role. Throws if not a member or role too low.
   * Role hierarchy: owner > admin > member > viewer
   */
  static async requireRole(
    workspaceId: string,
    userId: string,
    minRole: WorkspaceRole,
  ): Promise<WorkspaceRole> {
    const role = await WorkspaceRepo.checkMembership(workspaceId, userId);
    if (!role) {
      throw new Error('Not a member of this workspace');
    }
    const order: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];
    if (order.indexOf(role) < order.indexOf(minRole)) {
      throw new Error(`Requires role ${minRole} or higher`);
    }
    return role;
  }
}
