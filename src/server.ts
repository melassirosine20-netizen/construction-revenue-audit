/**
 * HTTP API entrypoint — Phase 1 + Phase 2 (upload shell)
 * Spec: docs/17-implementation-plan-v1.md § C (API surface)
 * Spec: docs/09-security.md · docs/06-import-workflow.md
 *
 * Session-based auth. All project routes enforce workspace membership.
 * No financial logic here.
 */
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { AuthService } from './domain/auth/authService.js';
import { ProjectRepo } from './db/repos/projectRepo.js';
import { ImportService, MAX_UPLOAD_BYTES } from './domain/import/importService.js';
import { MatchService } from './domain/matching/matchService.js';
import { AuditService } from './domain/audit/auditService.js';
import { findCrossImportDuplicates } from './domain/import/duplicateDetect.js';
import type { DocumentType, FindingStatus } from './domain/types.js';
import { getDb } from './db/db.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Refuse to start in production with the insecure default secret
const sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret === 'dev-only-change-me')) {
  throw new Error(
    'SESSION_SECRET environment variable must be set to a strong random value in production',
  );
}

// Ensure DB is initialised (in-memory by default; set DB_PATH for file)
await getDb(process.env.DB_PATH);

app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    name: 'cra.sid',
    secret: sessionSecret || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    // Default MemoryStore is fine for local/dev only. Production must use a
    // persistent store (Redis, Postgres, etc.) — not implemented in this MVP skeleton.
    cookie: {
      httpOnly: true,
      secure: isProd, // HTTPS-only cookies in production
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    email?: string;
  }
}

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/**
 * Regenerate the session to prevent fixation, then set identity.
 * Must be used after successful register/login.
 */
function establishSession(
  req: express.Request,
  userId: string,
  email: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      req.session.userId = userId;
      req.session.email = email;
      req.session.save((saveErr) => {
        if (saveErr) reject(saveErr);
        else resolve();
      });
    });
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, name, password, workspaceName } = req.body ?? {};
    const result = await AuthService.register({ email, name, password, workspaceName });
    await establishSession(req, result.user.id, result.user.email);
    res.status(201).json({
      user: result.user,
      workspace: result.workspace,
      role: result.role,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    // Avoid leaking whether an email exists when the failure is not a clear duplicate
    const status = message.includes('already registered') ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }
    const result = await AuthService.login(email, password);
    await establishSession(req, result.user.id, result.user.email);
    res.json({ user: result.user });
  } catch (err) {
    // Generic message — do not reveal whether email exists
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    // Always clear the cookie even if destroy reports an error
    res.clearCookie('cra.sid', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
    });
    if (err) {
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { UserRepo } = await import('./db/repos/workspaceRepo.js');
  const user = await UserRepo.findById(req.session.userId!);
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  const { passwordHash: _, ...safe } = user;
  res.json({ user: safe });
});

// ─── Workspaces (membership-scoped) ──────────────────────────────────────────

app.get('/api/workspaces', requireAuth, async (req, res) => {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT w.id, w.name, w.created_at as createdAt, w.updated_at as updatedAt, m.role
     FROM workspaces w
     JOIN workspace_memberships m ON m.workspace_id = w.id
     WHERE m.user_id = ?
     ORDER BY w.created_at DESC`,
  );
  stmt.bind([req.session.userId!]);
  const list: Array<Record<string, unknown>> = [];
  while (stmt.step()) {
    list.push(stmt.getAsObject());
  }
  stmt.free();
  res.json({ workspaces: list });
});

// ─── Projects (workspace-scoped) ─────────────────────────────────────────────

app.get('/api/workspaces/:workspaceId/projects', requireAuth, async (req, res) => {
  try {
    await AuthService.requireRole(req.params.workspaceId, req.session.userId!, 'viewer');
    const projects = await ProjectRepo.listByWorkspace(req.params.workspaceId);
    res.json({ projects });
  } catch (err) {
    res.status(403).json({ error: 'Forbidden' });
  }
});

app.post('/api/workspaces/:workspaceId/projects', requireAuth, async (req, res) => {
  try {
    await AuthService.requireRole(req.params.workspaceId, req.session.userId!, 'member');
    const { name, externalProjectNumber } = req.body ?? {};
    if (!name?.trim()) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }
    const project = await ProjectRepo.create(
      req.params.workspaceId,
      name.trim(),
      externalProjectNumber,
    );
    res.status(201).json({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forbidden';
    // Do not leak role hierarchy details to the client
    if (message.includes('Not a member') || message.includes('Requires role')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.status(400).json({ error: message });
  }
});

app.get('/api/workspaces/:workspaceId/projects/:projectId', requireAuth, async (req, res) => {
  try {
    await AuthService.requireRole(req.params.workspaceId, req.session.userId!, 'viewer');
    const project = await ProjectRepo.findById(req.params.workspaceId, req.params.projectId);
    if (!project) {
      // Same status whether missing or wrong workspace — reduces enumeration signal
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ project });
  } catch (err) {
    res.status(403).json({ error: 'Forbidden' });
  }
});

// ─── Document upload + import shell (Phase 2) ────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const VALID_DOCUMENT_TYPES = new Set<string>([
  'contract_sov',
  'change_order',
  'tm_ticket',
  'billing',
  'evidence',
  'unknown',
  // Not in frozen DocumentType enum; accepted as upload hint → stored as unknown + entityKind
  'rate_table',
]);

app.post(
  '/api/workspaces/:workspaceId/projects/:projectId/documents',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'CSV file is required (field name: file)' });
        return;
      }
      const documentTypeRaw = (req.body?.documentType as string) || 'unknown';
      if (!VALID_DOCUMENT_TYPES.has(documentTypeRaw)) {
        res.status(400).json({ error: `Unsupported documentType: ${documentTypeRaw}` });
        return;
      }
      // Frozen DocumentType enum does not include rate_table; map hint → unknown
      const documentType: DocumentType =
        documentTypeRaw === 'rate_table' ? 'unknown' : (documentTypeRaw as DocumentType);

      const result = await ImportService.uploadCsv({
        workspaceId: req.params.workspaceId,
        projectId: req.params.projectId,
        userId: req.session.userId!,
        filename: req.file.originalname || 'upload.csv',
        contentType: req.file.mimetype || 'application/octet-stream',
        buffer: req.file.buffer,
        documentType,
      });

      res.status(201).json({
        document: result.document,
        import: result.importRecord,
        headers: result.headers,
        rowCount: result.rowCount,
        sampleRows: result.sampleRows,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      if (message.includes('Not a member') || message.includes('Requires role') || message === 'Forbidden') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found') || message.includes('Project not found')) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      if (
        message.includes('exceeds maximum') ||
        message.includes('empty') ||
        message.includes('Only CSV') ||
        message.includes('CSV parse failed')
      ) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/imports',
  requireAuth,
  async (req, res) => {
    try {
      const imports = await ImportService.listImports(
        req.params.workspaceId,
        req.params.projectId,
        req.session.userId!,
      );
      res.json({ imports });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.status(403).json({ error: 'Forbidden' });
    }
  },
);

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/imports/:importId',
  requireAuth,
  async (req, res) => {
    try {
      const result = await ImportService.getImport(
        req.params.workspaceId,
        req.params.projectId,
        req.params.importId,
        req.session.userId!,
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(403).json({ error: 'Forbidden' });
    }
  },
);

// ─── Column mapping + normalization (Phase 3) ────────────────────────────────

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/imports/:importId/mapping/suggest',
  requireAuth,
  async (req, res) => {
    try {
      const entityKind = req.query.entityKind as string | undefined;
      const result = await ImportService.suggestColumnMapping(
        req.params.workspaceId,
        req.params.projectId,
        req.params.importId,
        req.session.userId!,
        entityKind as import('./domain/import/fieldCatalog.js').MappingEntityKind | undefined,
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

app.put(
  '/api/workspaces/:workspaceId/projects/:projectId/imports/:importId/mapping',
  requireAuth,
  async (req, res) => {
    try {
      const mapping = (req.body?.mapping ?? {}) as Record<string, string | null>;
      const entityKind = req.body?.entityKind as string | undefined;
      const result = await ImportService.saveMapping(
        req.params.workspaceId,
        req.params.projectId,
        req.params.importId,
        req.session.userId!,
        mapping,
        entityKind as import('./domain/import/fieldCatalog.js').MappingEntityKind | undefined,
      );
      const status = result.validation.valid ? 200 : 422;
      res.status(status).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

app.post(
  '/api/workspaces/:workspaceId/projects/:projectId/imports/:importId/commit',
  requireAuth,
  async (req, res) => {
    try {
      const entityKind = req.body?.entityKind as string | undefined;
      const result = await ImportService.commitImport(
        req.params.workspaceId,
        req.params.projectId,
        req.params.importId,
        req.session.userId!,
        entityKind as import('./domain/import/fieldCatalog.js').MappingEntityKind | undefined,
      );
      res.status(200).json({
        import: result.importRecord,
        successCount: result.normalize.successCount,
        errorCount: result.normalize.errorCount,
        persistedCount: result.persistedCount,
        warnings: result.normalize.warnings,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('mapping') || message.includes('Mapping')) {
        res.status(422).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

// ─── Matching (Phase 4) ──────────────────────────────────────────────────────

app.post(
  '/api/workspaces/:workspaceId/projects/:projectId/matches/run',
  requireAuth,
  async (req, res) => {
    try {
      const result = await MatchService.runForProject(
        req.params.workspaceId,
        req.params.projectId,
        req.session.userId!,
      );
      res.status(200).json({
        matchCount: result.matches.length,
        persistedCount: result.persistedCount,
        ambiguousCandidates: result.candidates.length,
        unmatchedBillingCount: result.unmatchedBillingIds.length,
        unmatchedTicketCount: result.unmatchedTicketIds.length,
        matches: result.matches,
        candidates: result.candidates,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/matches',
  requireAuth,
  async (req, res) => {
    try {
      const matches = await MatchService.listMatches(
        req.params.workspaceId,
        req.params.projectId,
        req.session.userId!,
      );
      res.json({ matches });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(403).json({ error: 'Forbidden' });
    }
  },
);

// ─── Audit runs + findings (Phase 6) ─────────────────────────────────────────

app.post(
  '/api/workspaces/:workspaceId/projects/:projectId/audit-runs',
  requireAuth,
  async (req, res) => {
    try {
      const asOfDate = (req.body?.as_of_date ?? req.body?.asOfDate) as string;
      if (!asOfDate) {
        res.status(400).json({ error: 'as_of_date is required (YYYY-MM-DD)' });
        return;
      }
      const result = await AuditService.runAudit({
        workspaceId: req.params.workspaceId,
        projectId: req.params.projectId,
        userId: req.session.userId!,
        asOfDate,
      });
      res.status(201).json({
        run: result.run,
        findings: result.findings,
        summary: result.run.summary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('as_of_date')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/audit-runs',
  requireAuth,
  async (req, res) => {
    try {
      const runs = await AuditService.listRuns(
        req.params.workspaceId,
        req.params.projectId,
        req.session.userId!,
      );
      res.json({ runs });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(403).json({ error: 'Forbidden' });
    }
  },
);

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/audit-runs/:runId',
  requireAuth,
  async (req, res) => {
    try {
      const result = await AuditService.getRun(
        req.params.workspaceId,
        req.params.projectId,
        req.params.runId,
        req.session.userId!,
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(403).json({ error: 'Forbidden' });
    }
  },
);

app.patch(
  '/api/workspaces/:workspaceId/projects/:projectId/findings/:findingId/status',
  requireAuth,
  async (req, res) => {
    try {
      const newStatus = (req.body?.status ?? req.body?.newStatus) as FindingStatus;
      const note = req.body?.note as string | undefined;
      const finding = await AuditService.updateFindingStatus({
        workspaceId: req.params.workspaceId,
        projectId: req.params.projectId,
        findingId: req.params.findingId,
        userId: req.session.userId!,
        newStatus,
        note,
      });
      res.json({ finding });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  },
);

app.get(
  '/api/workspaces/:workspaceId/projects/:projectId/duplicate-candidates',
  requireAuth,
  async (req, res) => {
    try {
      await AuthService.requireRole(req.params.workspaceId, req.session.userId!, 'viewer');
      const project = await ProjectRepo.findById(req.params.workspaceId, req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const candidates = await findCrossImportDuplicates(
        req.params.workspaceId,
        req.params.projectId,
      );
      res.json({ candidates, count: candidates.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forbidden';
      if (message.includes('Not a member') || message.includes('Requires role')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.status(403).json({ error: 'Forbidden' });
    }
  },
);

// Health (unauthenticated)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Construction Revenue Audit API listening on :${PORT}`);
  });
}

export { app };
