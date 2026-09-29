import { Severity } from "./analyzer-interface";
import {
  collectLifecycleWarnings,
  describeLifecycle,
  isExecutable,
  lifecycleStage,
  resolveReplacement,
  selectExecutableRules,
  type LifecycleRule,
} from "./rule-lifecycle";

function rule(
  id: string,
  overrides: Partial<LifecycleRule> = {},
): LifecycleRule {
  return {
    id,
    name: id,
    description: "",
    severity: Severity.LOW,
    category: "gas",
    enabled: true,
    ...overrides,
  };
}

const active = rule("g001");

const deprecated = rule("g002", {
  deprecation: {
    since: "2.0.0",
    reason: "Superseded by a more precise check.",
    replacedBy: "g010",
    removeIn: "3.0.0",
  },
});

const removed = rule("g003", {
  deprecation: {
    since: "1.5.0",
    reason: "The pattern it detected is no longer emitted by the compiler.",
    removedIn: "2.0.0",
  },
});

describe("lifecycleStage", () => {
  it("treats a rule without metadata as active", () => {
    expect(lifecycleStage(active)).toBe("active");
  });

  it("distinguishes deprecated from removed", () => {
    expect(lifecycleStage(deprecated)).toBe("deprecated");
    expect(lifecycleStage(removed)).toBe("removed");
  });
});

describe("isExecutable", () => {
  it("still runs a deprecated rule", () => {
    // The point of a deprecation period is that the rule keeps working while
    // consumers migrate. Stopping it at deprecation would defeat that.
    expect(isExecutable(deprecated)).toBe(true);
  });

  it("does not run a removed rule", () => {
    expect(isExecutable(removed)).toBe(false);
  });
});

describe("describeLifecycle", () => {
  it("says nothing about an active rule", () => {
    expect(describeLifecycle(active)).toBeNull();
  });

  it("names the version, reason, replacement and removal target", () => {
    const message = describeLifecycle(deprecated)!;
    expect(message).toContain("2.0.0");
    expect(message).toContain("Superseded");
    expect(message).toContain("g010");
    expect(message).toContain("3.0.0");
  });

  it("states plainly that a removed rule no longer runs", () => {
    const message = describeLifecycle(removed)!;
    expect(message).toContain("removed in 2.0.0");
    expect(message).toContain("no longer runs");
  });

  it("omits the replacement clause when there is no replacement", () => {
    const orphan = rule("g004", {
      deprecation: { since: "2.0.0", reason: "No longer useful." },
    });
    expect(describeLifecycle(orphan)).not.toContain("instead");
  });
});

describe("collectLifecycleWarnings", () => {
  const rules = [active, deprecated, removed];

  it("warns about a deprecated rule the config names", () => {
    const warnings = collectLifecycleWarnings(rules, {
      rules: { g002: true },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].ruleId).toBe("g002");
    expect(warnings[0].replacedBy).toBe("g010");
  });

  it("stays quiet about deprecated rules the config never mentions", () => {
    // Warning about every deprecated rule in the catalogue would bury the one
    // the user can actually act on.
    expect(collectLifecycleWarnings(rules, { rules: {} })).toEqual([]);
    expect(collectLifecycleWarnings(rules, undefined)).toEqual([]);
  });

  it("warns when a config tries to enable a removed rule", () => {
    const warnings = collectLifecycleWarnings(rules, { rules: { g003: true } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].stage).toBe("removed");
  });

  it("stays quiet when a config disables an already-removed rule", () => {
    // Disabling something that is already gone is harmless.
    expect(collectLifecycleWarnings(rules, { rules: { g003: false } })).toEqual(
      [],
    );
  });

  it("warns for a deprecated rule even when the config disables it", () => {
    // Still worth surfacing: the id will stop being recognised entirely.
    const warnings = collectLifecycleWarnings(rules, {
      rules: { g002: false },
    });
    expect(warnings).toHaveLength(1);
  });

  it("handles the object form of a config entry", () => {
    const warnings = collectLifecycleWarnings(rules, {
      rules: { g003: { enabled: true } },
    });
    expect(warnings).toHaveLength(1);
  });

  it("never warns about an active rule", () => {
    expect(collectLifecycleWarnings(rules, { rules: { g001: true } })).toEqual(
      [],
    );
  });
});

describe("selectExecutableRules", () => {
  const rules = [active, deprecated, removed];

  it("drops removed rules even when the config enables them", () => {
    const selected = selectExecutableRules(rules, { rules: { g003: true } });
    expect(selected.map((r) => r.id)).not.toContain("g003");
  });

  it("keeps deprecated rules that are enabled", () => {
    const selected = selectExecutableRules(rules, { rules: { g002: true } });
    expect(selected.map((r) => r.id)).toContain("g002");
  });

  it("respects an explicit disable", () => {
    const selected = selectExecutableRules(rules, { rules: { g001: false } });
    expect(selected.map((r) => r.id)).not.toContain("g001");
  });

  it("falls back to the rule's own enabled flag", () => {
    const offByDefault = rule("g005", { enabled: false });
    const selected = selectExecutableRules([active, offByDefault]);
    expect(selected.map((r) => r.id)).toEqual(["g001"]);
  });
});

describe("resolveReplacement", () => {
  it("follows a chain to the final replacement", () => {
    const chain = [
      rule("a", { deprecation: { since: "1", reason: "r", replacedBy: "b" } }),
      rule("b", { deprecation: { since: "2", reason: "r", replacedBy: "c" } }),
      rule("c"),
    ];
    expect(resolveReplacement(chain, "a")).toBe("c");
  });

  it("returns the id unchanged when there is no replacement", () => {
    expect(resolveReplacement([active], "g001")).toBe("g001");
  });

  it("does not hang on a cycle", () => {
    const cyclic = [
      rule("a", { deprecation: { since: "1", reason: "r", replacedBy: "b" } }),
      rule("b", { deprecation: { since: "1", reason: "r", replacedBy: "a" } }),
    ];
    expect(["a", "b"]).toContain(resolveReplacement(cyclic, "a"));
  });
});
