# Upgrade and Rollback Runbook (Issue #1009)

## Objective

One place that ties the existing pieces — migration safety, backups, canary
rollout, health checks — into a single sequence for shipping a production
change and reverting it if it goes wrong.

## Scope

Covers releases of `apps/api-service` (the `api` / `api-canary` Docker Compose
services) and its database migrations. `worker` and `dashboard` are deployed
after `api` is confirmed healthy (see Step 5) since they are not canaried
themselves.

## Prechecks

Do not start rollout until all of these are true:

| Precheck | How to verify |
|---|---|
| CI is green on the release commit | `node-lint`, `node-build`, `rust-test`, `stellar-regression`, `secret-scanning`, `dependency-audit`, `artifact-checksums` jobs in `.github/workflows/ci.yml` all pass |
| Migration safety gate passed | `.github/workflows/migration-safety.yml` (runs `node scripts/check-migrations.mjs`); any destructive migration has documented `ALLOW_DESTRUCTIVE_MIGRATIONS` approval per [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md) |
| Migrations are additive-only for this release, or a prior release already stopped reading the columns being dropped | [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md) "Rollback limits" table |
| Latest backup restore test succeeded within its cadence | [DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md) "Restore testing cadence" |
| Third-party notices regenerated if dependencies changed | `pnpm run license:notices` (+ `scripts/generate-rust-license-notices.sh` if `Cargo.lock` changed) — see [LICENSING_AND_THIRD_PARTY_NOTICES.md](LICENSING_AND_THIRD_PARTY_NOTICES.md) |
| Rollback owner assigned | One person on-call who can execute the Rollback procedure below without further approval |

## Rollout sequence

1. **Merge to `main`.** CI (prechecks table) must be green on the merge commit.
2. **Run migrations** (expand phase only): `pnpm --filter @gasguard/api-service run typeorm migration:run`.
   Stop here if this fails — do not proceed to Step 3 with an unmigrated or
   partially-migrated schema.
3. **Start the canary** at 5% traffic: `pnpm run canary start 5`. This snapshots
   the current image as `gasguard-api:rollback` before building the new one
   (see [CANARY_RELEASES.md](CANARY_RELEASES.md)).
4. **Evaluate and step up traffic**, checking rollback criteria at each stage:
   `pnpm run canary evaluate`, then `pnpm run canary start 25`, `evaluate`,
   `start 50`, `evaluate` — see the staged table in CANARY_RELEASES.md.
   Stop and roll back at the first `FAIL` (see Rollback triggers).
5. **Promote**: `pnpm run canary promote`. Confirm `api` is healthy
   (Recovery verification below) before continuing.
6. **Roll out `worker` and `dashboard`**: `docker compose up -d --build worker dashboard`.
   These aren't canaried; deploy them only once `api` has been stable at 100%
   for a soak period (recommend ≥ 15 minutes, matching the backup RPO window).
7. **Contract-phase migrations** (dropping columns/tables no longer read by the
   app) are a *separate, later* release, never bundled with the release that
   stops reading them — per MIGRATION_SAFETY.md policy.

## Rollback triggers

Roll back — don't try to "fix forward" — when any of these are observed:

| Trigger | Where it's measured | Action |
|---|---|---|
| `canary evaluate` reports `FAIL` (error rate delta > 2pp or p95 latency delta > 50%) | `pnpm run canary evaluate` exit code | `pnpm run canary rollback` (Step 3–4 only, `api` untouched) |
| Migration fails partway (Step 2) | Migration runner output / exit code | Do not proceed to Step 3; restore from backup if the schema is left inconsistent (see [DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md)) |
| `/health`, `/health/ready`, or `/health/live` on `api` returns non-2xx or times out after promote | Manual or monitoring probe against the promoted `api` | `pnpm run canary revert` |
| Redis unreachable and `RATE_LIMIT_FALLBACK_MODE=strict` causing widespread 503s | [REDIS_FAILURE_RECOVERY.md](REDIS_FAILURE_RECOVERY.md) | Follow that doc's recovery sequence; revert the release if the new version introduced the Redis issue |
| Error budget: sustained 5xx rate increase attributable to the release, observed for more than 5 minutes post-promote | `apps/api-service` logs / `api/performance` metrics | `pnpm run canary revert` |

## Rollback procedure

**During canary (Steps 3–4), before promote:**
```bash
pnpm run canary rollback
```
`api` (stable) was never rebuilt or restarted, so this is zero-risk to the
already-serving version.

**After promote (Step 5+), release already fully rolled out:**
```bash
pnpm run canary revert
```
Re-tags the pre-upgrade snapshot (`gasguard-api:rollback`, captured
automatically by `canary start`) back onto `gasguard-api:stable` and
recreates `api` from it.

**If the migration itself must be undone** (only when the rollback trigger
was a migration failure or the new schema is incompatible with the reverted
app version): follow the restore procedure in
[DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md) rather than hand-writing
a down migration against production data. Per MIGRATION_SAFETY.md, additive
migrations don't need this — the reverted app version simply ignores the new
column/table.

## Recovery verification

After any rollback/revert, or after promote before declaring the release
done, confirm:

1. `GET /health`, `/health/ready`, `/health/live` on the active `api` all
   return `200` with `status: "healthy"`.
2. `docker compose ps api api-canary nginx-canary` shows only the intended
   containers running (canary/proxy stopped after a rollback or promote).
3. Migration state matches what's expected for the running app version
   (no half-applied migration left behind).
4. `audit_logs` is still being written to (spot-check the most recent row's
   timestamp is current) — confirms the app can reach Postgres end-to-end.
5. If the trigger was a backup restore, record actual RPO/RTO achieved per
   DATABASE_BACKUP_RESTORE.md's post-incident step.
6. Post an incident/release note stating what was rolled back and why, so the
   next attempt at the same change starts from that context.

## Ownership

The engineer driving the release owns execution of this runbook end-to-end,
including the rollback decision — they do not need separate sign-off to roll
back once a trigger in the table above is met. Loosening a rollback threshold
itself (not just deciding to roll back this once) needs the same review as a
destructive migration.
