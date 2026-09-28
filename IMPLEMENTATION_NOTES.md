# Implementation: Issues #989–#995

| Issue | Deliverable |
|-------|-------------|
| #995 Migration safety | `scripts/check-migrations.mjs`, CI workflow, `docs/MIGRATION_SAFETY.md` |
| #991 Per-user / per-repo limits | `ScopedRateLimitService`, tests, internal bypass via `INTERNAL_BYPASS_TOKENS` |
| #990 Redis failure | `docs/REDIS_FAILURE_RECOVERY.md` |
| #989 DB backup/restore | `docs/DATABASE_BACKUP_RESTORE.md` |

## Verify
```bash
node scripts/check-migrations.mjs
node --test scripts/check-migrations.test.mjs
# rate limit unit tests (from apps/api)
npx jest scoped-rate-limit.service.spec
```
