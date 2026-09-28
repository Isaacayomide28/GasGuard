# Database Backup and Restore Procedures (Issue #989)

## Objectives

| Metric | Target (production) |
|--------|---------------------|
| **RPO** (Recovery Point Objective) | ≤ 15 minutes |
| **RTO** (Recovery Time Objective) | ≤ 1 hour for primary API database |
| **Backup frequency** | Continuous WAL archiving + base backup every 6 hours |
| **Retention** | 30 days rolling; monthly snapshot retained 1 year |
| **Encryption** | AES-256 at rest (volume or backup-tool encryption); TLS in transit |

Adjust numbers in the deployment runbook if your environment differs; do not weaken without security review.

## What is backed up

- Primary relational database used by `apps/api-service` (TypeORM entities / migrations)
- Not in scope of this DB procedure: Redis (see REDIS_FAILURE_RECOVERY.md), object storage, secrets managers

## Backup procedure

1. **Automated base backups** every 6 hours via the managed provider or `pg_basebackup` / equivalent.
2. **WAL / continuous archiving** enabled so point-in-time recovery (PITR) meets RPO.
3. **Encryption**: backups encrypted with a key held in the cloud KMS / HSM; application credentials never written into backup scripts in the repo.
4. **Verification job** (weekly): restore the latest backup into an isolated staging instance and run `SELECT 1` plus a row-count smoke query on critical tables.

## Restore procedure

1. Declare incident; freeze schema migrations (`ALLOW_DESTRUCTIVE_MIGRATIONS` must remain unset).
2. Provision a recovery instance (or promote a replica if failure is primary-only).
3. Restore base backup + replay WAL to the chosen recovery timestamp.
4. Validate:
   - Application can migrate **up to** current schema version without error
   - Auth and a sample read path succeed
5. Repoint application connection strings; drain old primary if applicable.
6. Post-incident: document actual RPO/RTO achieved.

## Restore testing cadence

| Test | Cadence | Owner |
|------|---------|-------|
| Automated backup success check | Daily | Platform |
| Staging full restore smoke test | Weekly | Platform |
| Documented game-day restore | Quarterly | Platform + on-call |

## Interaction with migrations

- Destructive migrations (see MIGRATION_SAFETY.md) require a verified backup taken **immediately before** apply.
- If a destructive migration fails mid-way, prefer restore to pre-migration snapshot over hand-written reverse SQL unless a tested `down` migration exists.

## Security notes

- Backup access is limited to platform/break-glass roles; application runtime roles cannot read backup buckets.
- Never commit connection strings, backup encryption keys, or production dumps to git.
- Sanitize any sample data used in restore drills.
