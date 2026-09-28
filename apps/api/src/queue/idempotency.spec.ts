import { IdempotencyStore } from "./idempotency";

describe("IdempotencyStore", () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore(60000);
  });

  it("should generate consistent keys", () => {
    const payload = { contract: "test", chain: "stellar" };
    const key1 = store.generateKey(payload);
    const key2 = store.generateKey(payload);
    expect(key1).toBe(key2);
  });

  it("should acquire a key successfully", () => {
    const key = store.generateKey({ test: 1 });
    expect(store.acquire(key, { test: 1 })).toBe(true);
    expect(store.has(key)).toBe(true);
  });

  it("should reject duplicate keys", () => {
    const key = store.generateKey({ test: 1 });
    store.acquire(key, { test: 1 });
    expect(store.acquire(key, { test: 1 })).toBe(false);
  });

  it("should release a key", () => {
    const key = store.generateKey({ test: 1 });
    store.acquire(key, { test: 1 });
    store.release(key);
    expect(store.has(key)).toBe(false);
  });

  it("should clear all keys", () => {
    store.acquire("key1", {});
    store.acquire("key2", {});
    store.clear();
    expect(store.has("key1")).toBe(false);
    expect(store.has("key2")).toBe(false);
  });
});
