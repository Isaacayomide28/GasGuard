/**
 * Stable cursor encoding for findings pagination (#992).
 *
 * Cursor payload: base64url(JSON({ v, k, id }))
 * - v: version
 * - k: sort key string for the last item (ISO date, severity rank, status, title)
 * - id: finding id (tie-breaker for stable ordering)
 */

export interface CursorPayload {
  v: 1;
  k: string;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorPayload {
  let json: string;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw Object.assign(new Error('Invalid cursor encoding'), {
      code: 'INVALID_CURSOR',
      status: 400,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw Object.assign(new Error('Invalid cursor payload'), {
      code: 'INVALID_CURSOR',
      status: 400,
    });
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as CursorPayload).v !== 1 ||
    typeof (parsed as CursorPayload).k !== 'string' ||
    typeof (parsed as CursorPayload).id !== 'string'
  ) {
    throw Object.assign(new Error('Unsupported cursor version or shape'), {
      code: 'INVALID_CURSOR',
      status: 400,
    });
  }
  return parsed as CursorPayload;
}
