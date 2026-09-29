# Findings API contract (#993)

## Purpose

Contract tests in `src/findings/__tests__/api.contract.spec.ts` lock the public
shape of findings list/detail handlers so validation, authorization, response
schemas, and error formats stay stable across releases.

## Response envelopes

**Success (list)**

```json
{
  "data": [ /* Finding */ ],
  "pagination": {
    "nextCursor": "string|null",
    "limit": 20
  }
}
```

**Success (getOne)**

```json
{
  "data": { /* Finding */ }
}
```

**Error (all failure paths)**

```json
{
  "error": {
    "code": "VALIDATION_ERROR | NOT_FOUND | INTERNAL_ERROR | …",
    "message": "human-readable message"
  }
}
```

Error bodies must not include stack traces or internal diagnostic fields.

## Authorization / tenancy

- `organizationId` is required (header `x-organization-id` preferred; query
  `organizationId` accepted for backward compatibility).
- Cross-tenant access to a finding id returns `404 NOT_FOUND` (not `403`) to
  avoid confirming existence of another tenant’s resource.
- List results are scoped to the requested organization only.

## Security & operational implications

- Contract tests use synthetic org/repo/job ids only; never commit real tokens,
  private keys, or production identifiers.
- Changing error `code` values or removing Finding fields is a **breaking**
  change and requires a versioned migration note.
- Prefer adding optional fields over renaming/removing existing ones.

## Running

```bash
cd apps/api
npm test -- api.contract
```
