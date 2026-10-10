/**
 * Cross-import duplicate business-key detection
 * Does not merge or delete — only reports candidates.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { resetDbForTests, getDb } from '../../src/db/db.js';
import { AuthService } from '../../src/domain/auth/authService.js';
import { ProjectRepo } from '../../src/db/repos/projectRepo.js';
import { findCrossImportDuplicates } from '../../src/domain/import/duplicateDetect.js';
import { v4 as uuidv4 } from 'uuid';

describe('findCrossImportDuplicates', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  test('detects same change_order_id from two different imports', async () => {
    const reg = await AuthService.register({
      email: 'dup@example.com',
      name: 'D',
      password: 'password123',
      workspaceName: 'WS',
    });
    const project = await ProjectRepo.create(reg.workspace.id, 'P');
    const db = await getDb();
    const now = new Date().toISOString();

    function insertCo(importId: string, coId: string) {
      db.run(
        `INSERT INTO change_orders (
          id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page,
          raw_values, change_order_id, title, description, status, change_method,
          submitted_date, approved_date, effective_date, original_amount, approved_amount,
          customer_reference, cost_code, expected_bill_after, source_reference, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuidv4(),
          project.id,
          reg.workspace.id,
          'doc',
          importId,
          '2',
          '{}',
          coId,
          't',
          'd',
          'approved',
          'fixed_price',
          null,
          '2025-03-20',
          null,
          100,
          100,
          '',
          '',
          null,
          '',
          now,
          now,
        ],
      );
    }

    insertCo('import-1', 'CO-001');
    insertCo('import-2', 'CO-001'); // same business key, different import

    const candidates = await findCrossImportDuplicates(reg.workspace.id, project.id);
    expect(candidates.some((c) => c.businessKey === 'CO-001' && c.importIds.length >= 2)).toBe(
      true,
    );
  });

  test('does not report keys unique to a single import', async () => {
    const reg = await AuthService.register({
      email: 'dup2@example.com',
      name: 'D',
      password: 'password123',
      workspaceName: 'WS',
    });
    const project = await ProjectRepo.create(reg.workspace.id, 'P');
    const db = await getDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO change_orders (
        id, project_id, workspace_id, source_document_id, source_import_id, source_row_or_page,
        raw_values, change_order_id, title, description, status, change_method,
        submitted_date, approved_date, effective_date, original_amount, approved_amount,
        customer_reference, cost_code, expected_bill_after, source_reference, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidv4(),
        project.id,
        reg.workspace.id,
        'doc',
        'import-only',
        '2',
        '{}',
        'CO-UNIQUE',
        't',
        'd',
        'approved',
        'fixed_price',
        null,
        '2025-03-20',
        null,
        100,
        100,
        '',
        '',
        null,
        '',
        now,
        now,
      ],
    );

    const candidates = await findCrossImportDuplicates(reg.workspace.id, project.id);
    expect(candidates.some((c) => c.businessKey === 'CO-UNIQUE')).toBe(false);
  });
});
