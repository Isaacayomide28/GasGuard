# Redis Failure and Recovery Behavior (Issue #990)

## Scope

GasGuard uses Redis for:

1. **Rate limiting** (`apps/api/src/rate-limiting`) – sliding-window counters
2. **Job queues** (Bull/BullMQ where configured) – async delivery / scans

This document specifies behavior when Redis is unreachable, restarting, or failing over.

## Rate limiting

| Mode (`RATE_LIMIT_FALLBACK_MODE`) | Redis down | Effect |
|-----------------------------------|------------|--------|
| `permissive` (default) | Unavailable | Requests **allowed**; counters not incremented; warning logged |
| `strict` | Unavailable | Requests rejected with **503 Service Unavailable** |

`RedisService.isReady()` gates all counter reads/writes. No in-memory substitute is used for multi-instance correctness.

### In-flight rate-limit checks

- A check that already read Redis successfully is not rolled back.
- Partial pipeline failures on `INCR` are logged; the request may have been allowed without a durable count (permissive under-count risk).

## Queued and in-flight jobs

| Job state | Redis unavailable | Behavior |
|-----------|-------------------|----------|
| **Queued** (waiting) | Broker down | Jobs remain in Redis AOF/RDB if persistence enabled; after restore they process in order. If Redis data is lost, **queued jobs are lost** (see RPO). |
| **Active / in-flight** | Worker loses connection mid-job | Worker fails the job; Bull retry policy applies when Redis returns. At-least-once delivery: handlers must be idempotent. |
| **Completed / failed** sets | Data loss event | Historical job metadata may disappear; business side-effects already applied are not automatically undone. |
| **Delayed / scheduled** | Data loss | Schedules lost; must be re-enqueued by application logic or ops replay. |

### Recovery sequence

1. Restore Redis from the latest RDB/AOF snapshot (coordinate with DATABASE_BACKUP_RESTORE if Redis is treated as stateful infra).
2. Confirm `PING` and `RedisService.isReady() === true`.
3. Restart API / worker processes if they entered a disconnected circuit.
4. Spot-check rate-limit keys (`gasguard:ratelimit:*`) and queue keys.
5. Replay any critical lost jobs from upstream audit logs if RPO was exceeded.

## Security implications

- In `permissive` mode, an attacker who can induce Redis failure effectively disables rate limits — monitor Redis health and alert on prolonged `isReady() === false`.
- Internal bypass tokens (`INTERNAL_BYPASS_TOKENS`) still apply when Redis is up; they do not require Redis.

## Testing

Integration tests in `rate-limiting/__tests__` mock `isReady() === false` for both fallback modes. Scoped limits (`ScopedRateLimitService`) follow the same fallback rules.
