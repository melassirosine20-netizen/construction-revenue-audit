/**
 * MatchService — orchestration for Phase 4
 * Auth + load normalized data + pure matching + persist.
 */
import { AuthService } from '../auth/authService.js';
import { ProjectRepo } from '../../db/repos/projectRepo.js';
import { MatchRepo } from '../../db/repos/matchRepo.js';
import { loadMatchingInput } from './snapshotBuilder.js';
import { runMatching, type MatchingResult } from './matching.js';

export class MatchService {
  /**
   * Recompute and replace matches for a project. Requires member+.
   * Deterministic: same normalized data → same match set (aside from matchId UUIDs).
   */
  static async runForProject(
    workspaceId: string,
    projectId: string,
    userId: string,
  ): Promise<MatchingResult & { persistedCount: number }> {
    await AuthService.requireRole(workspaceId, userId, 'member');
    const project = await ProjectRepo.findById(workspaceId, projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const input = await loadMatchingInput(workspaceId, projectId);
    const result = runMatching(input);
    const persistedCount = await MatchRepo.replaceForProject(
      workspaceId,
      projectId,
      result.matches,
    );

    return { ...result, persistedCount };
  }

  static async listMatches(
    workspaceId: string,
    projectId: string,
    userId: string,
  ) {
    await AuthService.requireRole(workspaceId, userId, 'viewer');
    const project = await ProjectRepo.findById(workspaceId, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return MatchRepo.listByProject(workspaceId, projectId);
  }
}
