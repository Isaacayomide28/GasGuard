import * as crypto from "crypto";

export interface IdempotencyKey {
  key: string;
  createdAt: Date;
  payload: any;
}

export class IdempotencyStore {
  private store: Map<string, IdempotencyKey> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  generateKey(payload: any): string {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    return `idem_${hash.slice(0, 16)}`;
  }

  acquire(key: string, payload: any): boolean {
    this.evictExpired();
    if (this.store.has(key)) {
      return false;
    }
    this.store.set(key, {
      key,
      createdAt: new Date(),
      payload,
    });
    return true;
  }

  has(key: string): boolean {
    this.evictExpired();
    return this.store.has(key);
  }

  release(key: string): void {
    this.store.delete(key);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt.getTime() > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}
