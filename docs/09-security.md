# 09 — Security

**Related:** [02-data-model.md](02-data-model.md) · [10-architecture.md](10-architecture.md)

The product handles potentially sensitive commercial and project financial information. Security is non-negotiable.

## Authentication

- Email + password (hashed with modern algorithm, e.g. Argon2id or bcrypt) **or** supported OAuth / SSO provider.
- Session-based or short-lived JWT with refresh rotation.
- MFA recommended for production; optional in early MVP if complexity is high.
- Password reset via secure, time-limited token.

## Authorization

- Role-based access control (RBAC) within a workspace:
  - `owner` — full control including billing and deletion
  - `admin` — manage users, projects, settings
  - `member` — create projects, import, review findings
  - `viewer` — read-only
- All API endpoints and data queries enforce workspace membership and role.

## Tenant Isolation

- Every table that holds customer data includes `workspace_id`.
- All queries are scoped by the authenticated user’s workspace(s).
- No cross-tenant joins or leaks are permitted.
- Object storage keys are namespaced by workspace_id.
- Automated tests must include isolation checks.

## File Access

- Uploaded files stored in private object storage (S3-compatible or Supabase Storage).
- Access only via short-lived signed URLs issued after authorization check.
- Never serve files through a public bucket for customer data.

## Encryption

- **In transit:** TLS 1.2+ for all external traffic.
- **At rest:** Database encryption (provider-managed or application-level for sensitive fields). Object storage server-side encryption enabled.
- Secrets (API keys, DB credentials) never committed to source control; injected via environment / secret manager.

## Secrets Management

- Use environment variables or a secrets manager.
- Rotate credentials periodically.
- No secrets in client-side code or public repositories.

## Logging & Monitoring

- Application logs must not contain passwords, full card data, or unnecessary PII.
- Security-relevant events logged: login success/failure, permission denials, data export, deletion.
- Centralized log aggregation recommended for production.

## Deletion & Data Retention

- Soft-delete preferred for projects and findings (retain audit trail).
- Hard-delete (workspace or user request) must cascade or anonymize according to policy.
- Document retention period (default suggestion: 7 years for financial audit data, configurable).
- Provide a documented process for customer data export and deletion requests.

## Audit Trail

- Immutable (or append-only) records for:
  - Imports
  - Audit runs
  - Finding status changes
  - Review actions
  - User role changes
- Audit trail itself is tenant-scoped.

## Least Privilege

- Application database user has only the permissions it needs.
- Background jobs run with restricted credentials.
- No shared admin accounts in production.

## Explicit Non-Goals for Security MVP

- Full SOC 2 certification (pursue later)
- Advanced threat detection / SIEM (add when scale justifies)
- End-to-end encryption of every field (evaluate later)

## Incident Response (Minimum)

- Documented contact for security issues.
- Ability to revoke sessions and rotate secrets quickly.
- Customer notification process for confirmed breaches involving their data.
