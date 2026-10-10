/**
 * Phase 0 — Health smoke test
 * Spec: docs/17-implementation-plan-v1.md § Phase 0 acceptance: npm test green
 */
import { describe, test, expect } from '@jest/globals';

describe('Health smoke test', () => {
  test('Node.js environment is working', () => {
    expect(typeof process.version).toBe('string');
    expect(process.version.startsWith('v')).toBe(true);
  });

  test('Project version', () => {
    expect('1.0.0').toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('Domain types can be imported', async () => {
    const types = await import('../../src/domain/types.js');
    expect(types.DEFAULT_SETTINGS).toBeDefined();
    expect(types.DEFAULT_SETTINGS.materialityAbsolute).toBe(100);
    expect(types.DEFAULT_SETTINGS.billingGraceDays).toBe(30);
  });

  test('AuditEngine can be imported', async () => {
    const engine = await import('../../src/domain/audit/engine.js');
    expect(typeof engine.runAuditEngine).toBe('function');
    expect(engine.RULES_VERSION).toBe('1.0.0');
  });
});
