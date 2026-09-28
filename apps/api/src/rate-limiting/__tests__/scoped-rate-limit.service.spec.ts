/**
 * Issue #991 – unit tests for per-user / per-repository limits and bypass.
 */
import {
  DEFAULT_REPOSITORY_QUOTA,
  DEFAULT_USER_QUOTA,
  ScopedRateLimitService,
} from "../services/scoped-rate-limit.service";

describe("ScopedRateLimitService (issue #991)", () => {
  const redisMock = {
    isReady: jest.fn().mockReturnValue(true),
    getClient: jest.fn(),
  };

  const config = {
    enabled: true,
    fallbackMode: "permissive" as const,
    redis: {} as any,
    defaultTier: "free" as any,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    redisMock.isReady.mockReturnValue(true);
    process.env.INTERNAL_BYPASS_TOKENS = "trusted-ci-token";
  });

  function makeService() {
    return new ScopedRateLimitService(redisMock as any, config as any);
  }

  it("exposes configurable default quotas for user and repository", () => {
    const svc = makeService();
    expect(svc.getQuota("user")).toEqual(DEFAULT_USER_QUOTA);
    expect(svc.getQuota("repository")).toEqual(DEFAULT_REPOSITORY_QUOTA);
  });

  it("allows internal bypass when token matches", () => {
    const svc = makeService();
    expect(svc.isInternalBypass("trusted-ci-token")).toBe(true);
    expect(svc.isInternalBypass("random")).toBe(false);
    expect(svc.isInternalBypass(undefined)).toBe(false);
  });

  it("returns allowed status for bypass without touching Redis", async () => {
    const svc = makeService();
    const status = await svc.checkScopedLimit({
      scope: "user",
      id: "user-1",
      internalToken: "trusted-ci-token",
    });
    expect(status.allowed).toBe(true);
    expect(redisMock.getClient).not.toHaveBeenCalled();
  });

  it("denies when window counter is at limit", async () => {
    const pipeline = { incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn() };
    const client = {
      get: jest.fn().mockResolvedValue("30"), // at user per-minute default
      pipeline: () => pipeline,
    };
    redisMock.getClient.mockReturnValue(client);
    const svc = makeService();
    const status = await svc.checkScopedLimit({
      scope: "user",
      id: "user-1",
    });
    expect(status.allowed).toBe(false);
    expect(status.window).toBe("minute");
    expect(status.remaining).toBe(0);
  });

  it("allows when under limit", async () => {
    const client = {
      get: jest.fn().mockResolvedValue("1"),
      pipeline: () => ({
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn(),
      }),
    };
    redisMock.getClient.mockReturnValue(client);
    const svc = makeService();
    const status = await svc.checkScopedLimit({
      scope: "repository",
      id: "mdtechlabs/gasguard",
    });
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBeGreaterThan(0);
  });
});
