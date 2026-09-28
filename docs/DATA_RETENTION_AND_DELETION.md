# Data Retention and Deletion (Issue #1011)

## Objective

Document how long each category of data is kept, and provide a safe,
auditable way to delete it early on request — for repositories (scanned
source), findings, logs, and user data.

## Data categories and retention periods

| Category | Where it lives | Default retention | Configurable via | Deletion mechanism |
|---|---|---|---|---|
| Repositories (scanned source code) | `analysis_results.sourceCode` | 180 days | `ANALYSIS_RESULT_RETENTION_DAYS` | Scheduled purge; on-demand merchant purge |
| Findings | `analysis_results.findings` (same row as source) | 180 days | `ANALYSIS_RESULT_RETENTION_DAYS` | Scheduled purge; on-demand merchant purge |
| Audit / access logs | `audit_logs` (API requests, key lifecycle, auth, admin actions — see [AUDIT_LOGGING_SYSTEM.md](AUDIT_LOGGING_SYSTEM.md)) | 90 days | `AUDIT_LOG_RETENTION_DAYS` | Scheduled purge |
| User data (PII) | `users` (email, name, password hash, login IP) | Kept while the account is active | n/a — request-driven, not time-driven | On-demand anonymization |
| Database backups | Managed provider / `pg_basebackup` | 30 days rolling, monthly snapshot for 1 year (see [DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md)) | Backup tooling config | Rolls off automatically; **not** touched by the workflows below |
| Redis cache | `redis` service in `docker-compose.yml` | TTL per key, no durable retention | Cache config | Expires naturally; see [REDIS_FAILURE_RECOVERY.md](REDIS_FAILURE_RECOVERY.md) |

Retention windows for audit logs and analysis results follow the same
90/180-day defaults already recommended in AUDIT_LOGGING_SYSTEM.md's
"Recommended Policies" section, now actually enforced by a scheduled job
instead of only documented.

**Backups are out of scope for the deletion workflows below.** Deleting or
anonymizing a row in the primary database does not remove it from an
already-taken backup; it only stops future backups from including it. A
user's data can persist in backups for up to the backup retention window (30
days rolling / 1 year for monthly snapshots) after an erasure request — state
this when responding to a data-subject request.

## Automatic (scheduled) deletion

`DataRetentionCleanupService` (`apps/api-service/src/data-retention/services/data-retention-cleanup.service.ts`)
runs daily at 02:00, after the backup window, and:

1. Calls the existing `AuditLogService.retentionCleanup(days)` to delete
   `audit_logs` rows older than `AUDIT_LOG_RETENTION_DAYS`. This method
   already existed but was never wired to run — it is now scheduled.
2. Deletes `analysis_results` rows (repositories + findings) older than
   `ANALYSIS_RESULT_RETENTION_DAYS`.

Both deletes are hard deletes (`DELETE ... WHERE <timestamp> < cutoff`), scoped
by an indexed timestamp column, matching the pattern already used by
`AuditLogRepository.deleteOlderThan`.

## On-demand deletion

Time-based purges don't cover a specific data-subject request ("delete my
data now") or an offboarded merchant. `POST/DELETE /admin/data-retention/*`
(admin-only, `DataRetentionController`) covers those cases:

| Endpoint | Effect |
|---|---|
| `POST /admin/data-retention/purge` | Runs the scheduled cleanup immediately; returns counts deleted |
| `DELETE /admin/data-retention/users/:userId` | Anonymizes the user's PII (email, name, password hash, login IP) in place |
| `DELETE /admin/data-retention/merchants/:merchantId/analysis-results` | Hard-deletes all repositories/findings for that merchant |

The two delete endpoints require `{"confirm": "DELETE"}` in the request body —
the same explicit-approval pattern already used for destructive database
migrations (see [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md)) — so a stray or
replayed request can't trigger irreversible deletion.

### Why anonymize users instead of deleting the row

`audit_logs` is append-only by design (integrity hash per row, see
AUDIT_LOGGING_SYSTEM.md) and rows reference a user id for compliance
traceability. Hard-deleting the `users` row would either orphan those log
references or force deleting compliance-relevant logs early. Instead,
`UserDataDeletionService.anonymizeUser` overwrites PII fields in place
(`email`, `firstName`, `lastName`, `passwordHash`, `lastLoginIp`) and
deactivates the account, so:

- The account can no longer authenticate or be identified by email/name.
- Audit log rows referencing the (now-anonymized) user id remain intact for
  the log's own retention window.
- The user id itself is retained only as an opaque reference, not PII.

## Ownership

Triage/security owns the retention defaults; changing `AUDIT_LOG_RETENTION_DAYS`
or `ANALYSIS_RESULT_RETENTION_DAYS` below current values should get the same
review as a destructive migration, since it shortens how long data is
recoverable. Raising them is lower risk but should be documented in the PR
that changes the env var.
