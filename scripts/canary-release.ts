#!/usr/bin/env ts-node
/**
 * Canary release CLI for the Docker Compose deployment (Issue #1010).
 *
 * Brings up `api-canary` and `nginx-canary` alongside the untouched `api`
 * (stable) service, splits traffic between them at a configurable weight,
 * evaluates the canary against measurable rollback criteria (error rate,
 * p95 latency, consecutive health-check failures), and either promotes it
 * to stable or rolls it back. See docs/CANARY_RELEASES.md for the full
 * process and rationale.
 *
 * Usage:
 *   ts-node scripts/canary-release.ts start [weightPercent=5]
 *   ts-node scripts/canary-release.ts evaluate [--samples=50] [--max-error-rate-delta=0.02] [--max-p95-latency-delta=0.5]
 *   ts-node scripts/canary-release.ts promote
 *   ts-node scripts/canary-release.ts rollback
 *   ts-node scripts/canary-release.ts status
 */
import { execSync } from "child_process";

const STABLE_HEALTH_URL =
  process.env.STABLE_HEALTH_URL || "http://localhost:3000/health";
const CANARY_HEALTH_URL =
  process.env.CANARY_HEALTH_URL ||
  `http://localhost:${process.env.CANARY_API_PORT || 3001}/health`;

interface ProbeResult {
  requests: number;
  errors: number;
  errorRate: number;
  latenciesMs: number[];
  p95LatencyMs: number;
  avgLatencyMs: number;
}

interface RollbackCriteria {
  /** Canary error rate may exceed stable's by at most this many percentage points (0-1 scale). */
  maxErrorRateDelta: number;
  /** Canary p95 latency may exceed stable's by at most this fraction (0.5 = 50% slower). */
  maxP95LatencyDelta: number;
  /** Canary fails the release outright once it has this many consecutive probe failures. */
  maxConsecutiveFailures: number;
}

const DEFAULT_CRITERIA: RollbackCriteria = {
  maxErrorRateDelta: 0.02,
  maxP95LatencyDelta: 0.5,
  maxConsecutiveFailures: 5,
};

function run(cmd: string): void {
  console.log(`[canary] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

async function probe(url: string, samples: number): Promise<ProbeResult> {
  let errors = 0;
  let consecutiveFailures = 0;
  let maxConsecutiveFailures = 0;
  const latenciesMs: number[] = [];

  for (let i = 0; i < samples; i++) {
    const start = Date.now();
    try {
      const res = await fetch(url);
      latenciesMs.push(Date.now() - start);
      if (!res.ok) {
        errors++;
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }
    } catch {
      latenciesMs.push(Date.now() - start);
      errors++;
      consecutiveFailures++;
    }
    maxConsecutiveFailures = Math.max(
      maxConsecutiveFailures,
      consecutiveFailures,
    );
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  return {
    requests: samples,
    errors,
    errorRate: samples === 0 ? 0 : errors / samples,
    latenciesMs,
    p95LatencyMs: percentile(sorted, 95),
    avgLatencyMs:
      latenciesMs.reduce((sum, v) => sum + v, 0) / (latenciesMs.length || 1),
  };
}

function start(weightPercent: number): void {
  const canaryWeight = Math.max(1, Math.min(99, Math.round(weightPercent)));
  const stableWeight = 100 - canaryWeight;

  console.log(
    `[canary] Starting canary at ~${canaryWeight}% of traffic ` +
      `(weights: stable=${stableWeight}, canary=${canaryWeight})`,
  );

  process.env.STABLE_WEIGHT = String(stableWeight);
  process.env.CANARY_WEIGHT = String(canaryWeight);

  run("docker compose --profile canary build api-canary");
  run("docker compose --profile canary up -d api-canary nginx-canary");

  console.log(
    "[canary] Canary is live. Run `evaluate` once you've let traffic flow, " +
      "then `promote` or `rollback`.",
  );
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = /^--([a-z0-9-]+)=(.+)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
  }
  return flags;
}

async function evaluate(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const samples = Number(flags["samples"] || 50);
  const criteria: RollbackCriteria = {
    maxErrorRateDelta: Number(
      flags["max-error-rate-delta"] ?? DEFAULT_CRITERIA.maxErrorRateDelta,
    ),
    maxP95LatencyDelta: Number(
      flags["max-p95-latency-delta"] ?? DEFAULT_CRITERIA.maxP95LatencyDelta,
    ),
    maxConsecutiveFailures: Number(
      flags["max-consecutive-failures"] ??
        DEFAULT_CRITERIA.maxConsecutiveFailures,
    ),
  };

  console.log(`[canary] Probing stable (${STABLE_HEALTH_URL}) and canary (${CANARY_HEALTH_URL}), ${samples} requests each...`);

  const [stable, canary] = await Promise.all([
    probe(STABLE_HEALTH_URL, samples),
    probe(CANARY_HEALTH_URL, samples),
  ]);

  const errorRateDelta = canary.errorRate - stable.errorRate;
  const p95LatencyDelta =
    stable.p95LatencyMs === 0
      ? canary.p95LatencyMs > 0
        ? Infinity
        : 0
      : (canary.p95LatencyMs - stable.p95LatencyMs) / stable.p95LatencyMs;

  console.log("[canary] Results:");
  console.log(
    `  stable: errorRate=${(stable.errorRate * 100).toFixed(1)}% ` +
      `p95=${stable.p95LatencyMs}ms avg=${stable.avgLatencyMs.toFixed(0)}ms`,
  );
  console.log(
    `  canary: errorRate=${(canary.errorRate * 100).toFixed(1)}% ` +
      `p95=${canary.p95LatencyMs}ms avg=${canary.avgLatencyMs.toFixed(0)}ms`,
  );
  console.log(
    `  delta:  errorRate=+${(errorRateDelta * 100).toFixed(1)}pp ` +
      `p95=${(p95LatencyDelta * 100).toFixed(0)}%`,
  );

  const failures: string[] = [];
  if (errorRateDelta > criteria.maxErrorRateDelta) {
    failures.push(
      `error rate delta ${(errorRateDelta * 100).toFixed(1)}pp exceeds ` +
        `max ${(criteria.maxErrorRateDelta * 100).toFixed(1)}pp`,
    );
  }
  if (p95LatencyDelta > criteria.maxP95LatencyDelta) {
    failures.push(
      `p95 latency delta ${(p95LatencyDelta * 100).toFixed(0)}% exceeds ` +
        `max ${(criteria.maxP95LatencyDelta * 100).toFixed(0)}%`,
    );
  }

  if (failures.length > 0) {
    console.log("[canary] FAIL — rollback criteria breached:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log("[canary] PASS — canary is within rollback criteria.");
}

function promote(): void {
  console.log("[canary] Promoting canary to stable...");
  run("docker tag gasguard-api:canary gasguard-api:stable");
  run("docker compose up -d --no-build api");
  run("docker compose --profile canary stop api-canary nginx-canary");
  run("docker compose --profile canary rm -f api-canary nginx-canary");
  console.log("[canary] Promoted. Stable now runs the former canary image.");
}

function rollback(): void {
  console.log("[canary] Rolling back — stopping canary, stable untouched...");
  run("docker compose --profile canary stop api-canary nginx-canary");
  run("docker compose --profile canary rm -f api-canary nginx-canary");
  console.log("[canary] Rolled back. `api` was never rebuilt, so it is unaffected.");
}

function status(): void {
  run("docker compose ps api api-canary nginx-canary");
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "start":
      start(Number(rest[0] ?? 5));
      break;
    case "evaluate":
      await evaluate(rest);
      break;
    case "promote":
      promote();
      break;
    case "rollback":
      rollback();
      break;
    case "status":
      status();
      break;
    default:
      console.log(
        "Usage: ts-node scripts/canary-release.ts <start|evaluate|promote|rollback|status> [args]",
      );
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[canary] Failed:", error);
  process.exitCode = 1;
});
