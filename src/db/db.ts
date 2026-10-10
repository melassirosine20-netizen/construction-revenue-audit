/**
 * Database client and migrations for Construction Revenue Audit SaaS.
 * Pure SQLite WASM / memory & file persistence without native C++ compilation.
 * Aligned strictly to docs/02-data-model.md and docs/17-implementation-plan-v1.md § B.
 */
import initSqlJs, { Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  external_project_number TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'unknown',
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  column_mapping TEXT, -- JSONB
  row_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warnings TEXT, -- JSONB
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS raw_records (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  raw_payload TEXT NOT NULL, -- JSONB
  created_at TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES imports(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS contract_sov_lines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  contract_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  cost_code TEXT NOT NULL,
  description TEXT NOT NULL,
  original_amount REAL NOT NULL,
  approved_revised_amount REAL NOT NULL,
  quantity REAL,
  unit TEXT,
  unit_price REAL,
  retainage REAL,
  source_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS change_orders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  change_order_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  change_method TEXT NOT NULL,
  submitted_date TEXT,
  approved_date TEXT,
  effective_date TEXT,
  original_amount REAL NOT NULL,
  approved_amount REAL NOT NULL,
  customer_reference TEXT NOT NULL,
  cost_code TEXT NOT NULL,
  expected_bill_after TEXT,
  source_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS change_order_lines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  change_order_id TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  cost_code TEXT,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  approved_unit_price REAL NOT NULL,
  approved_amount REAL NOT NULL,
  rate_type TEXT NOT NULL,
  rate_basis TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS tm_tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  ticket_id TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  worker_or_category TEXT NOT NULL,
  labor_hours REAL NOT NULL,
  labor_rate REAL NOT NULL,
  labor_rate_type TEXT NOT NULL,
  labor_amount REAL NOT NULL,
  material_amount REAL NOT NULL,
  equipment_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  approval_status TEXT NOT NULL,
  customer_signature INTEGER NOT NULL,
  billable_status TEXT NOT NULL,
  billing_expected TEXT NOT NULL,
  billing_basis TEXT NOT NULL,
  linked_change_order_id TEXT,
  expected_bill_after TEXT,
  source_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS billing_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  billing_id TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  line_id TEXT NOT NULL,
  description TEXT NOT NULL,
  cost_code TEXT NOT NULL,
  change_order_id TEXT,
  change_order_line_number INTEGER,
  amount REAL NOT NULL,
  quantity REAL,
  unit_price REAL,
  unit TEXT,
  retainage REAL,
  billed_to_date REAL,
  billing_date TEXT,
  source_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS rate_table (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  rate_id TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  rate_basis TEXT NOT NULL,
  amount REAL NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  match_method TEXT NOT NULL,
  match_confidence REAL NOT NULL,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  source_row_or_page TEXT NOT NULL,
  raw_values TEXT NOT NULL, -- JSONB
  evidence_id TEXT NOT NULL,
  date TEXT,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  file_reference TEXT NOT NULL,
  page_reference TEXT NOT NULL,
  timestamp TEXT,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  confidence TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  status TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  summary TEXT, -- JSONB
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  audit_run_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  financial_direction TEXT NOT NULL,
  severity TEXT NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'OPEN',
  related_records TEXT NOT NULL, -- JSONB
  related_finding_ids TEXT NOT NULL, -- JSONB
  amount_signed REAL,
  amount_at_risk REAL NOT NULL,
  calculation TEXT NOT NULL,
  calculation_json TEXT NOT NULL, -- JSONB
  explanation TEXT NOT NULL,
  confidence TEXT NOT NULL,
  is_secondary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id)
);

CREATE TABLE IF NOT EXISTS finding_events (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id TEXT,
  note TEXT,
  previous_status TEXT,
  new_status TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES findings(id)
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  materiality_absolute REAL NOT NULL DEFAULT 100,
  materiality_pct REAL NOT NULL DEFAULT 0.005,
  rounding_currency REAL NOT NULL DEFAULT 0.01,
  rounding_quantity REAL NOT NULL DEFAULT 0.001,
  billing_grace_days INTEGER NOT NULL DEFAULT 30,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Indices for multi-tenancy and fast lookup
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_imports_project ON imports(project_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id, change_order_id);
CREATE INDEX IF NOT EXISTS idx_co_lines_project ON change_order_lines(project_id, change_order_id);
CREATE INDEX IF NOT EXISTS idx_tm_tickets_project ON tm_tickets(project_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_billing_items_project ON billing_items(project_id, change_order_id);
CREATE INDEX IF NOT EXISTS idx_findings_audit_run ON findings(audit_run_id, project_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_finding_events_finding ON finding_events(finding_id);
`;

let dbInstance: Database | null = null;
let dbPath: string | null = null;

export async function getDb(filePath?: string): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  if (filePath) {
    dbPath = filePath;
    if (existsSync(filePath)) {
      const fileBuffer = readFileSync(filePath);
      dbInstance = new SQL.Database(fileBuffer);
    } else {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      dbInstance = new SQL.Database();
      dbInstance.run(SCHEMA_SQL);
      saveDb();
    }
  } else {
    dbInstance = new SQL.Database();
    dbInstance.run(SCHEMA_SQL);
  }

  return dbInstance;
}

export function saveDb(): void {
  if (dbInstance && dbPath) {
    const data = dbInstance.export();
    writeFileSync(dbPath, Buffer.from(data));
  }
}

export function closeDb(): void {
  if (dbInstance) {
    saveDb();
    dbInstance.close();
    dbInstance = null;
    dbPath = null;
  }
}

/**
 * Force a fresh in-memory database. Intended for unit tests only.
 * Closes any existing connection and creates a new schema.
 */
export async function resetDbForTests(): Promise<Database> {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* ignore */
    }
    dbInstance = null;
    dbPath = null;
  }
  return getDb(); // in-memory
}
