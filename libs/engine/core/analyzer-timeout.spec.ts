import {
  AnalyzerTimeoutError,
  DEFAULT_ANALYZER_TIMEOUT_MS,
  resolveTimeoutMs,
  runWithTimeout,
  toErrorDiagnostic,
} from "./analyzer-timeout";
import { runAnalyzerSafely, runAnalyzers } from "./analyzer-runner";
import {
  Analyzer,
  AnalysisResult,
  AnalyzerConfig,
  Language,
  Rule,
} from "./analyzer-interface";

const result = (findings = 0): AnalysisResult => ({
  findings: Array.from({ length: findings }, (_, i) => ({
    ruleId: `r${i}`,
    message: "m",
    severity: "low" as never,
    location: { file: "a.sol", startLine: 1, endLine: 1 },
  })),
  filesAnalyzed: 1,
  analysisTime: 0,
  analyzerVersion: "1.0.0",
  summary: { critical: 0, high: 0, medium: 0, low: findings, info: 0 },
});

function analyzer(
  name: string,
  behaviour: (files: Map<string, string>) => Promise<AnalysisResult>,
  rules: Rule[] = [],
): Analyzer {
  return {
    getName: () => name,
    getVersion: () => "1.0.0",
    analyze: async () => result(),
    analyzeMultiple: behaviour,
    supportsLanguage: () => true,
    getSupportedLanguages: () => [Language.SOLIDITY],
    getRules: () => rules,
    getRule: (id) => rules.find((r) => r.id === id),
    validateConfig: () => [],
    initialize: async () => undefined,
    dispose: async () => undefined,
  };
}

const files = new Map([["a.sol", "contract A {}"]]);

describe("resolveTimeoutMs", () => {
  it("defaults when nothing is configured", () => {
    expect(resolveTimeoutMs()).toBe(DEFAULT_ANALYZER_TIMEOUT_MS);
    expect(resolveTimeoutMs({})).toBe(DEFAULT_ANALYZER_TIMEOUT_MS);
  });

  it("uses an explicit budget", () => {
    expect(resolveTimeoutMs({ timeoutMs: 500 })).toBe(500);
  });

  it("treats zero and negatives as 'no limit' rather than 'fail instantly'", () => {
    // A 0 that meant "budget of nothing" would make every analyzer time out
    // the moment someone tried to disable the limit.
    expect(resolveTimeoutMs({ timeoutMs: 0 })).toBeNull();
    expect(resolveTimeoutMs({ timeoutMs: -1 })).toBeNull();
    expect(resolveTimeoutMs({ timeoutMs: Number.NaN })).toBeNull();
    expect(
      resolveTimeoutMs({ timeoutMs: Number.POSITIVE_INFINITY }),
    ).toBeNull();
  });
});

describe("runWithTimeout", () => {
  it("returns the value when work finishes in time", async () => {
    const value = await runWithTimeout(async () => "done", {
      analyzer: "a",
      files: ["a.sol"],
      timeoutMs: 1000,
    });
    expect(value).toBe("done");
  });

  it("rejects with a diagnostic when the budget is exceeded", async () => {
    const hang = () => new Promise<never>(() => {});

    await expect(
      runWithTimeout(hang, {
        analyzer: "slow-analyzer",
        analyzerVersion: "2.1.0",
        files: ["a.sol", "b.sol"],
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(AnalyzerTimeoutError);
  });

  it("names the analyzer, budget and files in the diagnostic", async () => {
    const hang = () => new Promise<never>(() => {});

    try {
      await runWithTimeout(hang, {
        analyzer: "slow-analyzer",
        analyzerVersion: "2.1.0",
        files: ["a.sol", "b.sol"],
        timeoutMs: 20,
      });
      throw new Error("should have timed out");
    } catch (error) {
      const diagnostic = (error as AnalyzerTimeoutError).diagnostic;
      expect(diagnostic.kind).toBe("timeout");
      expect(diagnostic.analyzer).toBe("slow-analyzer");
      expect(diagnostic.analyzerVersion).toBe("2.1.0");
      expect(diagnostic.timeoutMs).toBe(20);
      expect(diagnostic.files).toEqual(["a.sol", "b.sol"]);
      expect(diagnostic.message).toContain("slow-analyzer");
    }
  });

  it("never times out when the limit is disabled", async () => {
    const value = await runWithTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return "slow but allowed";
      },
      { analyzer: "a", files: [], timeoutMs: null },
    );
    expect(value).toBe("slow but allowed");
  });

  it("truncates a long file list so the diagnostic stays bounded", async () => {
    const many = Array.from({ length: 50 }, (_, i) => `f${i}.sol`);
    try {
      await runWithTimeout(() => new Promise<never>(() => {}), {
        analyzer: "a",
        files: many,
        timeoutMs: 10,
      });
      throw new Error("should have timed out");
    } catch (error) {
      const { files: reported } = (error as AnalyzerTimeoutError).diagnostic;
      expect(reported.length).toBe(11);
      expect(reported[10]).toContain("40 more");
    }
  });

  it("propagates a genuine error rather than reporting a timeout", async () => {
    await expect(
      runWithTimeout(
        async () => {
          throw new Error("parse failure");
        },
        { analyzer: "a", files: [], timeoutMs: 1000 },
      ),
    ).rejects.toThrow("parse failure");
  });
});

describe("runAnalyzerSafely", () => {
  it("returns the analyzer's result when it succeeds", async () => {
    const outcome = await runAnalyzerSafely(
      analyzer("ok", async () => result(2)),
      files,
    );
    expect(outcome.diagnostic).toBeUndefined();
    expect(outcome.result.findings).toHaveLength(2);
  });

  it("degrades a hung analyzer to an empty result plus a diagnostic", async () => {
    const outcome = await runAnalyzerSafely(
      analyzer("hanging", () => new Promise(() => {})),
      files,
      { timeoutMs: 20 },
    );

    expect(outcome.diagnostic?.kind).toBe("timeout");
    expect(outcome.result.findings).toEqual([]);
    // The failure is visible through the existing errors channel.
    expect(outcome.result.errors?.[0].message).toContain("hanging");
  });

  it("degrades a throwing analyzer the same way", async () => {
    const outcome = await runAnalyzerSafely(
      analyzer("broken", async () => {
        throw new Error("bad AST");
      }),
      files,
    );

    expect(outcome.diagnostic?.kind).toBe("error");
    expect(outcome.diagnostic?.message).toContain("bad AST");
    expect(outcome.result.findings).toEqual([]);
  });

  it("does not throw, whatever the analyzer does", async () => {
    await expect(
      runAnalyzerSafely(
        analyzer("nasty", async () => {
          throw "a string, not an Error";
        }),
        files,
      ),
    ).resolves.toBeDefined();
  });
});

describe("runAnalyzers", () => {
  it("keeps results from healthy analyzers when one hangs", async () => {
    // This is the behaviour the issue is really about: one bad analyzer must
    // not cost you every other analyzer's findings.
    const outcome = await runAnalyzers(
      [
        analyzer("first", async () => result(1)),
        analyzer("hanging", () => new Promise(() => {})),
        analyzer("third", async () => result(3)),
      ],
      files,
      { timeoutMs: 20 },
    );

    expect(outcome.results).toHaveLength(3);
    expect(outcome.results[0].findings).toHaveLength(1);
    expect(outcome.results[1].findings).toHaveLength(0);
    expect(outcome.results[2].findings).toHaveLength(3);
    expect(outcome.diagnostics).toHaveLength(1);
    expect(outcome.diagnostics[0].analyzer).toBe("hanging");
  });

  it("reports one diagnostic per failing analyzer", async () => {
    const outcome = await runAnalyzers(
      [
        analyzer("hang-a", () => new Promise(() => {})),
        analyzer("throw-b", async () => {
          throw new Error("nope");
        }),
      ],
      files,
      { timeoutMs: 20 },
    );

    expect(outcome.diagnostics.map((d) => d.kind).sort()).toEqual([
      "error",
      "timeout",
    ]);
  });
});

describe("toErrorDiagnostic", () => {
  it("handles a non-Error throw", () => {
    const diagnostic = toErrorDiagnostic("just a string", {
      analyzer: "a",
      files: ["x.sol"],
      elapsedMs: 5,
    });
    expect(diagnostic.kind).toBe("error");
    expect(diagnostic.message).toContain("just a string");
  });
});
