/**
 * Issue #991 – Per-user and per-repository rate limits.
 *
 * Complements API-key sliding windows with independent scopes:
 *   - user:{userId}
 *   - repo:{owner}/{name}  (GitHub-style repository identity)
 *
 * Trusted internal callers (service accounts / CI bots) can bypass via
 * X-GasGuard-Internal-Token matching INTERNAL_BYPASS_TOKENS.
 */

import { Injectable, Logger, Inject } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { RateLimitConfig } from "../config/rate-limit.config";
import {
  RateLimitStatus,
  WINDOW_DURATIONS,
  REDIS_KEY_PREFIXES,
} from "../schemas/rate-limit.schema";

export type RateLimitScope = "user" | "repository";

export interface ScopedQuota {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

/** Default quotas when env overrides are absent. */
export const DEFAULT_USER_QUOTA: ScopedQuota = {
  requestsPerMinute: 30,
  requestsPerHour: 500,
  requestsPerDay: 2000,
};

export const DEFAULT_REPOSITORY_QUOTA: ScopedQuota = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 5000,
};

export interface ScopedLimitCheckInput {
  scope: RateLimitScope;
  /** userId or "owner/repo" */
  id: string;
  /** Optional internal bypass token from request header */
  internalToken?: string;
}

@Injectable()
export class ScopedRateLimitService {
  private readonly logger = new Logger(ScopedRateLimitService.name);
  private readonly bypassTokens: Set<string>;

  constructor(
    private readonly redisService: RedisService,
    @Inject("RATE_LIMIT_CONFIG")
    private readonly config: RateLimitConfig,
  ) {
    const raw = process.env.INTERNAL_BYPASS_TOKENS || "";
    this.bypassTokens = new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }

  /** Trusted internal callers skip user/repo limits. */
  isInternalBypass(token?: string): boolean {
    if (!token) return false;
    return this.bypassTokens.has(token);
  }

  getQuota(scope: RateLimitScope): ScopedQuota {
    if (scope === "user") {
      return {
        requestsPerMinute: numEnv("RATE_LIMIT_USER_PER_MINUTE", DEFAULT_USER_QUOTA.requestsPerMinute),
        requestsPerHour: numEnv("RATE_LIMIT_USER_PER_HOUR", DEFAULT_USER_QUOTA.requestsPerHour),
        requestsPerDay: numEnv("RATE_LIMIT_USER_PER_DAY", DEFAULT_USER_QUOTA.requestsPerDay),
      };
    }
    return {
      requestsPerMinute: numEnv("RATE_LIMIT_REPO_PER_MINUTE", DEFAULT_REPOSITORY_QUOTA.requestsPerMinute),
      requestsPerHour: numEnv("RATE_LIMIT_REPO_PER_HOUR", DEFAULT_REPOSITORY_QUOTA.requestsPerHour),
      requestsPerDay: numEnv("RATE_LIMIT_REPO_PER_DAY", DEFAULT_REPOSITORY_QUOTA.requestsPerDay),
    };
  }

  private redisKey(scope: RateLimitScope, id: string, window: string): string {
    const prefix = REDIS_KEY_PREFIXES.rateLimit;
    return `${prefix}:${scope}:${id}:${window}`;
  }

  async checkScopedLimit(input: ScopedLimitCheckInput): Promise<RateLimitStatus> {
    if (!this.config.enabled) {
      return allowedStatus();
    }
    if (this.isInternalBypass(input.internalToken)) {
      return { ...allowedStatus(), window: "minute" };
    }
    if (!this.redisService.isReady()) {
      if (this.config.fallbackMode === "strict") {
        return {
          allowed: false,
          limit: 0,
          remaining: 0,
          resetTime: Date.now() + 60_000,
          window: "minute",
        };
      }
      return allowedStatus();
    }

    const quota = this.getQuota(input.scope);
    const windows: Array<{
      window: "minute" | "hour" | "day";
      limit: number;
      duration: number;
    }> = [
      { window: "minute", limit: quota.requestsPerMinute, duration: WINDOW_DURATIONS.minute },
      { window: "hour", limit: quota.requestsPerHour, duration: WINDOW_DURATIONS.hour },
      { window: "day", limit: quota.requestsPerDay, duration: WINDOW_DURATIONS.day },
    ];

    const client = this.redisService.getClient()!;
    for (const { window, limit, duration } of windows) {
      const key = this.redisKey(input.scope, input.id, window);
      const raw = await client.get(key);
      const count = raw ? parseInt(raw, 10) : 0;
      if (count >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetTime: Math.floor(Date.now() / 1000) + duration,
          window,
        };
      }
    }

    const minute = windows[0];
    const key = this.redisKey(input.scope, input.id, minute.window);
    const raw = await client.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    return {
      allowed: true,
      limit: minute.limit,
      remaining: Math.max(0, minute.limit - count - 1),
      resetTime: Math.floor(Date.now() / 1000) + minute.duration,
      window: "minute",
    };
  }

  async incrementScoped(input: ScopedLimitCheckInput): Promise<void> {
    if (!this.config.enabled || this.isInternalBypass(input.internalToken)) {
      return;
    }
    if (!this.redisService.isReady()) {
      this.logger.warn("Redis unavailable; skipping scoped counter increment");
      return;
    }
    const client = this.redisService.getClient()!;
    const pipeline = client.pipeline();
    for (const window of ["minute", "hour", "day"] as const) {
      const duration = WINDOW_DURATIONS[window];
      const key = this.redisKey(input.scope, input.id, window);
      pipeline.incr(key);
      pipeline.expire(key, duration);
    }
    await pipeline.exec();
  }
}

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function allowedStatus(): RateLimitStatus {
  return {
    allowed: true,
    limit: Infinity,
    remaining: Infinity,
    resetTime: 0,
    window: "minute",
  };
}
