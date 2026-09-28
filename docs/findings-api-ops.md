# Findings API — operations & security notes (#992–#996)

## Pagination (#992)

- **Cursor-based** pages (`cursor`, `limit`) avoid offset drift when new findings are inserted mid-scroll.
- Cursors are opaque `base64url` JSON (`v`, `k`, `id`). Clients must treat them as opaque.
- `limit` is capped at **100** (`MAX_PAGE_LIMIT`). Default **20**.
- Invalid cursors return **400** `INVALID_CURSOR` — do not retry with the same value.

### Filters & sort

| Query | Description |
|-------|-------------|
| `organizationId` / header `x-organization-id` | **Required** tenant scope |
| `repositoryId` | Optional repo filter |
| `analysisJobId` | Findings for one analysis job |
| `severity` | CSV of critical\|high\|medium\|low\|info |
| `status` | CSV of open\|suppressed\|resolved\|accepted |
| `ruleId` | Exact rule id |
| `q` | Case-insensitive substring on title/description/path |
| `sortBy` | createdAt\|severity\|status\|title |
| `sortDir` | asc\|desc |

## Authorization & isolation (#996)

- Every list/get is scoped by **organizationId**. Cross-tenant IDs return the same **404 NOT_FOUND** as missing IDs (no existence oracle).
- Repository filters are additive within the tenant; they never expand scope across orgs.
- **Operational implication:** API gateways must inject/validate `x-organization-id` from the authenticated principal; clients must not be trusted to self-assert arbitrary org IDs in production.

## Contract stability (#993)

Success list shape:

```json
{
  "data": [ /* Finding */ ],
  "pagination": { "nextCursor": "…|null", "limit": 20, "totalEstimate": 0 }
}
```

Error shape:

```json
{ "error": { "code": "VALIDATION_ERROR|NOT_FOUND|INVALID_CURSOR|INTERNAL_ERROR", "message": "…" } }
```

## Analysis workflow (#994)

Findings are written when an analysis job completes via `FindingsService.persistAnalysisFindings`. Retrieval uses `analysisJobId` filter. Empty issue sets complete successfully with zero findings.

## Secrets

Do not log full finding payloads that may include source snippets from private repos in shared log drains without redaction.
