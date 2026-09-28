# Administrator and Operator Guide

This is the entry point for anyone installing, configuring, or operating a
GasGuard deployment — as opposed to the [rule-authoring](RULE_TESTING_FRAMEWORK.md)
or [plugin-development](PLUGIN_DEVELOPMENT.md) docs, which are for people
extending the analyzer itself.

Sections: [Installation](#installation) · [Configuration](#configuration) ·
[Operational procedures](#operational-procedures) · [Security](#security) ·
[Troubleshooting](#troubleshooting) · [Known implementation gaps](#known-implementation-gaps)

## Installation

### Prerequisites

- **Node.js 20** (managed via `.nvmrc`)
- **Rust**, stable channel (managed via `rust-toolchain.toml`)
- **pnpm** as the Node.js package manager
- **Docker & Docker Compose**, for the full stack (API, worker, Postgres, Redis, dashboard)

### CLI (Rust analyzer)

```bash
cargo install --force --path apps/api --bin gasguard
gasguard --help
```

Core subcommands (`apps/api/src/main.rs`):

| Command | Purpose |
|---|---|
| `gasguard scan <file> [--format console\|json] [--auto-fix] [--plugin <path>]` | Scan a single file |
| `gasguard scan-dir <directory> [--format console\|json] [--plugin <path>]` | Scan a directory |
| `gasguard fix <path> [--preview]` | Apply safe auto-fixes |
| `gasguard analyze <path>` | Storage optimization analysis |
| `gasguard tiered-scan <file> --tier <tier> --usage <n>` | Scan under a pricing tier |
| `gasguard tiers [--tier <tier>] [--comparison]` | Show tier info |

### Full stack (API + worker + dependencies)

```bash
./scripts/setup.sh      # verifies toolchain, installs Node deps
pnpm install
docker-compose up -d    # postgres, redis, api, worker, dashboard
```

`docker-compose.yml` builds `apps/api/Dockerfile` (API) and
`apps/api/Dockerfile` (worker), and exposes:

| Service | Port | Health check |
|---|---|---|
| API | 3000 | `GET /health` |
| Dashboard | 8080 | — |
| Postgres | 5432 | `pg_isready` |
| Redis | 6379 | `redis-cli ping` |

For local development without Docker: `cd apps/api && npm install && npm run start:dev`.

## Configuration

GasGuard has two independent config layers — don't confuse them.

### 1. Project-level scan config: `.gasguardrc`

Read per-project by the CLI (`src/config/config-loader.ts`). JSON or a small
YAML subset; any of `.gasguardrc`, `.gasguardrc.json`, `.gasguardrc.yaml`,
`.gasguardrc.yml`. Unset fields fall back to defaults.

```json
{
  "ignoreRules": ["uint8-vs-uint256"],
  "includePaths": ["."],
  "excludePaths": ["legacy/"],
  "severityThreshold": "medium"
}
```

`severityThreshold` must be one of `critical | high | medium | low | info`.

### 2. Analyzer/rule configuration: `config/gasguard.config.json`

Loaded by `ConfigManager` (`src/config/config-manager.ts`), this is the
system + rule + profile configuration used by `RuleConfigService`. It covers
logging, performance, security toggles (`enableApiKeyValidation`,
`enableRateLimiting`, `maxRequestsPerMinute`), feature flags, the full rule
list, and named profiles (e.g. `strict-security`).

Every rule entry is validated against the JSON Schema at
`src/schemas/rule-config.schema.json` before `ConfigManager.addRule`/
`updateRule` will accept it — invalid rules are rejected (the call returns
`false` and a `ruleValidationFailed` event is emitted) rather than silently
corrupting the config file. See `src/config/rule-config-schema.ts`.

To validate a whole config file (not just one rule) before deploying it, use
`validateConfigFile()` / `validateConfig()` in `src/config/validator.ts` —
it returns structured `{ path, message, code }` errors and warnings for every
field in `system`, `rules`, and `profiles`.

### 3. Runtime environment variables

Set these for the Docker/production deployment (`docker-compose.yml` shows
the full set with defaults):

| Variable | Default | Used for |
|---|---|---|
| `NODE_ENV` | `production` | Runtime mode |
| `PORT` | `3000` | API listen port |
| `DATABASE_URL` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `gasguard` / `gasguard123` / `gasguard` | Postgres connection |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `redis` / `6379` / `redis123` | Redis connection (BullMQ queue, caching) |
| `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` | `60` / `10` | Global IP rate limiting window (seconds) / max requests |
| `INTERNAL_BYPASS_TOKENS` | unset | Comma-separated tokens allowed to bypass scoped rate limits via `X-GasGuard-Internal-Token` (`apps/api/src/rate-limiting/services/scoped-rate-limit.service.ts`) |
| `JWT_SECRET` | **must be changed** | Auth token signing — the compose default (`your-secret-key-change-in-production`) is not safe for production |
| `WORKER_CONCURRENCY` / `WORKER_REPLICAS` | `5` / `2` | Job worker scaling |
| `ALLOW_DESTRUCTIVE_MIGRATIONS` | unset | Must be explicitly `true` to let a destructive migration land — see [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md) |

**Never deploy with the default `JWT_SECRET`, `DB_PASSWORD`, or `REDIS_PASSWORD`** — they exist only so `docker-compose up` works out of the box for local development.

## Operational procedures

### Health and readiness

- `GET /health` — overall status
- `GET /health/ready` — readiness probe (use for load-balancer/orchestrator readiness gates)
- `GET /health/live` — liveness probe (use for restart decisions)

(`apps/api-service/src/health/health.controller.ts`)

### Monitoring

- `GET /dashboard/metrics` — operational metrics (`apps/api-service/src/dashboard`)
- `GET /alerting/rules`, `GET /alerting/rules/:id` — configured alert thresholds
- `GET /alerting/oncall/:service` — on-call ownership lookup for a service
- `GET /staging-parity/check` — detects drift between staging and the config being promoted to production
- Queue-level metrics and distributed tracing are collected by `MetricsCollector` in `apps/api/src/queue/metrics.ts`

### Queue operations

The BullMQ-backed job queue (`apps/api/src/queue/index.ts`) provides:

- **Idempotency** — duplicate jobs with the same key are deduplicated (`queue/idempotency.ts`)
- **Retry + dead-letter handling** — failed jobs retry with backoff before landing in a DLQ (`queue/retry.ts`)
- **Graceful shutdown** — in-flight jobs drain before a worker exits (`queue/shutdown.ts`)

If `REDIS_HOST`/`redisUrl` is not configured, the queue falls back to an
in-process in-memory queue — fine for local dev, not for a multi-instance
production deployment (jobs won't be shared across instances).

### Migrations, backups, and recovery

- Migrations are checked in CI by the **Migration Safety** workflow before merge — see [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md)
- Database backup/restore procedure — see [DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md)
- Redis failure/recovery behavior — see [REDIS_FAILURE_RECOVERY.md](REDIS_FAILURE_RECOVERY.md)

### Releases

Every release (mainnet cut or later patch) follows [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
The one-time mainnet launch blocker list is tracked separately in
[PRODUCTION_READINESS_REVIEW.md](PRODUCTION_READINESS_REVIEW.md).

## Security

- **Rate limiting**: global IP-based limiting via `@nestjs/throttler` (`RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`), plus per-user/per-repository scoped limits in `apps/api/src/rate-limiting/services/scoped-rate-limit.service.ts` with an internal bypass mechanism gated by `INTERNAL_BYPASS_TOKENS`.
- **Audit logging**: every API request, API key lifecycle event, and gas transaction is logged to an append-only Postgres table with a SHA-256 integrity hash. See [AUDIT_LOGGING_SYSTEM.md](AUDIT_LOGGING_SYSTEM.md) and [AUDIT_INTEGRATION_GUIDE.md](AUDIT_INTEGRATION_GUIDE.md). Query via `GET /audit/logs`, export via `POST /audit/logs/export`.
- **CI security gates**: Secret Scanning (Gitleaks), Dependency & Supply-Chain Audit (`npm audit` + `cargo audit`), and Artifact Checksums (SHA-256) all run in `.github/workflows/ci.yml` on every push/PR.
- **Migration safety**: destructive migrations are blocked in CI unless `ALLOW_DESTRUCTIVE_MIGRATIONS=true` is set deliberately.

## Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| `ConfigValidationError` on startup | `config/gasguard.config.json` fails schema validation | Run `validateConfigFile('config/gasguard.config.json')` (`src/config/validator.ts`) and read the `path`/`code` in each reported error |
| `ConfigManager.addRule`/`updateRule` silently returns `false` | The rule failed `src/schemas/rule-config.schema.json` validation | Listen for the `ruleValidationFailed` event on `ConfigManager`, or call `RuleConfigService.validateRule()` directly to get the error list |
| `/health/ready` failing | Postgres or Redis not reachable, or migrations pending | Check `docker-compose ps`, `pg_isready`, `redis-cli ping`; re-run migration safety checks |
| Jobs stuck / not processing | Queue fell back to in-memory mode because `REDIS_HOST` isn't set, or worker crashed mid-job | Confirm `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` are set; check `GracefulShutdown` logs for a shutdown that didn't complete |
| Legitimate internal service getting 429s | Scoped rate limit hit and no bypass token supplied | Set `X-GasGuard-Internal-Token` to a value listed in `INTERNAL_BYPASS_TOKENS` |
| CLI reports no findings on a file you expect findings for | Rule is disabled via `.gasguardrc` `ignoreRules`, path is in `excludePaths`, or `severityThreshold` is filtering it out | Check the resolved config: `loadConfig()` output, and confirm the rule ID isn't in `ignoreRules` |
| Migration blocked in CI | Migration contains a destructive pattern (`DROP TABLE`, `TRUNCATE`, unconditional `DELETE`, etc.) | Either fix the migration or set `ALLOW_DESTRUCTIVE_MIGRATIONS=true` deliberately after review — see [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md) |

## Known implementation gaps

Some issues in the mainnet-readiness workstream were closed with **stub
implementations only** — a one-line placeholder function, not the working
feature the issue title describes. Administrators should not assume these
are load-bearing without verifying the actual file first:

- `src/api/health.ts` (`healthCheck()`), `src/config/defaults.ts` (`safeDefaults`), `src/config/envValidation.ts` (`validateEnv()`) — from issues #956–#959, merged via PR #976
- `src/auth/apiKeys.ts`, `src/sandbox/untrusted.ts`, `src/security/ssrf.ts` — from issues #960–#963, merged via PR #975
- `src/findings/suppression.ts`, `src/registry/versioned.ts`, `src/schemas/finding.ts` — from issues #964–#966, #968, merged via PR #974
- `src/actions/annotations.ts`, `src/cli/jsonOutput.ts`, `src/exports/sarif.ts` — from issues #969–#972, merged via PR #973

Each of these files is a one- or two-line stub with no real logic. Before
relying on strict env-var validation, SSRF-safe fetching, code sandboxing,
API key lifecycle enforcement, SARIF export, or CI annotations in
production, re-verify the current state of the linked file — do not trust
the closed-issue status alone. This should be corrected before the
[production readiness review](PRODUCTION_READINESS_REVIEW.md) sign-off is
treated as final.
