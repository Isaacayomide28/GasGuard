# Canary Release Support (Issue #1010)

## Objective

Release a change to a controlled subset of traffic before full rollout, with
measurable, automatable rollback criteria — instead of cutting straight from
"deployed to staging" to "100% of production traffic."

## How it works

The Docker Compose deployment (`docker-compose.yml`) gets two additional,
opt-in services, both under the `canary` [Compose profile](https://docs.docker.com/compose/how-tos/profiles/)
so a normal `docker compose up` never starts them:

- **`api-canary`** — the same image as `api`, built from the change under
  test and tagged `gasguard-api:canary`. `api` (tagged `gasguard-api:stable`)
  is never rebuilt during a canary run, so it keeps serving the last-promoted
  release throughout.
- **`nginx-canary`** — a weighted reverse proxy (`docker/nginx/canary.conf.template`)
  in front of both, splitting traffic by the relative weights `STABLE_WEIGHT` /
  `CANARY_WEIGHT`.

`scripts/canary-release.ts` drives the whole cycle:

```bash
# Build api-canary from the current tree and start it at ~5% of traffic
pnpm run canary start 5

# Probe stable vs canary and check them against rollback criteria
pnpm run canary evaluate

# If evaluate passes and you're ready for more traffic, restart at a higher weight
CANARY_WEIGHT=25 STABLE_WEIGHT=75 pnpm run canary start 25

# Once satisfied: promote (stable becomes the former canary; canary infra torn down)
pnpm run canary promote

# Or, if evaluate fails or something looks wrong: roll back (stable untouched)
pnpm run canary rollback
```

`docker compose ps api api-canary nginx-canary` (or `pnpm run canary status`)
shows what's currently running.

## Recommended stages

Move through increasing weights, evaluating at each stage before continuing —
don't jump straight to a large percentage:

| Stage | Canary weight | Purpose |
|---|---|---|
| 1 | 5% | Catch crash-level regressions with minimal blast radius |
| 2 | 25% | Confirm the change holds up under a meaningful traffic share |
| 3 | 50% | Final check before full cutover |
| 4 | 100% (`promote`) | Full rollout |

Roll back immediately at any stage if `evaluate` fails rather than trying to
push through to the next stage.

## Measurable rollback criteria

`pnpm run canary evaluate` samples both the stable and canary `/health`
endpoints directly (bypassing the proxy, so each instance is measured in
isolation) and compares:

| Criterion | Default threshold | Flag to override |
|---|---|---|
| Error rate delta (canary − stable) | ≤ 2 percentage points | `--max-error-rate-delta=0.02` |
| p95 latency delta (canary vs stable) | ≤ 50% slower | `--max-p95-latency-delta=0.5` |
| Sample size | 50 requests per instance | `--samples=50` |

Breaching either threshold is a `FAIL` (non-zero exit code, so it can gate a
CI/CD step); both must pass for a `PASS`. These thresholds are deliberately
narrow to start — loosen them only with a documented reason, the same way
`docs/MIGRATION_SAFETY.md` treats its own destructive-change gate.

## Why weights instead of percentages of 100

nginx upstream `weight=` values are relative, not literal percentages
(`weight=5` / `weight=95` behaves the same as `weight=1` / `weight=19`).
`scripts/canary-release.ts start <percent>` converts a 1–99 percent input
into `CANARY_WEIGHT` / `STABLE_WEIGHT` for you; changing the weight later
requires recreating `nginx-canary` (`start` again with a new value), since
nginx only reads the templated config at container start.

## Rollback safety

`rollback` only stops and removes `api-canary` and `nginx-canary` — `api`
(stable) is never rebuilt or restarted by any canary command, so a rollback
cannot itself introduce a regression on the stable path. `promote` re-tags
the canary image as `gasguard-api:stable` and recreates `api` from that tag
(`--no-build`, so it uses the already-built canary image rather than
rebuilding from source again) before tearing down the canary services.

## Relationship to the upgrade/rollback runbook

Canary is one stage of a release, not the whole process. Prechecks (schema
migration safety, backup verification) and the full rollback trigger list
live in [UPGRADE_ROLLBACK_RUNBOOK.md](UPGRADE_ROLLBACK_RUNBOOK.md); this doc
only covers the canary-specific traffic-shifting mechanics.
