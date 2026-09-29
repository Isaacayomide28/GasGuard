import {
  Analyzer,
  AnalysisResult,
  Language,
  Severity,
} from "./analyzer-interface";
import {
  buildCompatibilityMatrix,
  isMatrixHealthy,
  renderMatrixMarkdown,
} from "./compatibility-matrix";
import type { LifecycleRule } from "./rule-lifecycle";

const emptyResult = (): AnalysisResult => ({
  findings: [],
  filesAnalyzed: 0,
  analysisTime: 0,
  analyzerVersion: "1.0.0",
  summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
});

function analyzer(
  name: string,
  languages: Array<Language | string>,
  options: {
    version?: string;
    dependencies?: string[];
    rules?: LifecycleRule[];
  } = {},
): Analyzer {
  const rules = options.rules ?? [];
  return {
    getName: () => name,
    getVersion: () => options.version ?? "1.0.0",
    analyze: async () => emptyResult(),
    analyzeMultiple: async () => emptyResult(),
    supportsLanguage: (l) => languages.map(String).includes(String(l)),
    getSupportedLanguages: () => languages as Language[],
    getDependencies: options.dependencies
      ? () => options.dependencies!
      : undefined,
    getRules: () => rules,
    getRule: (id) => rules.find((r) => r.id === id),
    validateConfig: () => [],
    initialize: async () => undefined,
    dispose: async () => undefined,
  };
}

function rule(
  id: string,
  deprecation?: LifecycleRule["deprecation"],
): LifecycleRule {
  return {
    id,
    name: id,
    description: "",
    severity: Severity.LOW,
    category: "gas",
    enabled: true,
    deprecation,
  };
}

const at = () => new Date("2026-01-01T00:00:00.000Z");

describe("buildCompatibilityMatrix", () => {
  it("records each analyzer's languages, version and dependencies", () => {
    const matrix = buildCompatibilityMatrix(
      [
        analyzer("solidity", [Language.SOLIDITY], { version: "2.0.0" }),
        analyzer("rust", [Language.RUST, Language.SOROBAN], {
          dependencies: ["solidity"],
        }),
      ],
      [],
      at,
    );

    expect(matrix.analyzers.map((a) => a.analyzer)).toEqual([
      "rust",
      "solidity",
    ]);
    expect(matrix.analyzers[1].version).toBe("2.0.0");
    expect(matrix.analyzers[0].languages).toEqual(["rust", "soroban"]);
    expect(matrix.analyzers[0].dependencies).toEqual(["solidity"]);
  });

  it("maps languages to the analyzers covering them", () => {
    const matrix = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY]), analyzer("b", [Language.RUST])],
      [],
      at,
    );
    expect(matrix.coverage["solidity"]).toEqual(["a"]);
    expect(matrix.coverage["rust"]).toEqual(["b"]);
  });

  it("flags a language nobody analyzes", () => {
    // This is the dangerous gap: files in that language produce zero findings,
    // which looks exactly like a clean result.
    const matrix = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY])],
      [Language.SOLIDITY, Language.CAIRO],
      at,
    );

    const gap = matrix.issues.find((i) => i.kind === "uncovered-language");
    expect(gap?.language).toBe("cairo");
    expect(gap?.message).toContain("indistinguishable from being clean");
  });

  it("does not flag an expected language that is covered", () => {
    const matrix = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY])],
      [Language.SOLIDITY],
      at,
    );
    expect(
      matrix.issues.filter((i) => i.kind === "uncovered-language"),
    ).toEqual([]);
  });

  it("flags overlapping coverage so it is a decision, not an accident", () => {
    const matrix = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY]), analyzer("b", [Language.SOLIDITY])],
      [],
      at,
    );

    const overlap = matrix.issues.find(
      (i) => i.kind === "overlapping-coverage",
    );
    expect(overlap?.language).toBe("solidity");
    expect(overlap?.analyzers).toEqual(["a", "b"]);
  });

  it("flags an analyzer that declares no languages", () => {
    const matrix = buildCompatibilityMatrix([analyzer("orphan", [])], [], at);
    const issue = matrix.issues.find((i) => i.kind === "no-languages");
    expect(issue?.message).toContain("never be selected");
  });

  it("flags a dependency on an unregistered analyzer", () => {
    const matrix = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY], { dependencies: ["missing"] })],
      [],
      at,
    );
    const issue = matrix.issues.find((i) => i.kind === "missing-dependency");
    expect(issue?.analyzers).toEqual(["a", "missing"]);
  });

  it("counts deprecated and removed rules per analyzer", () => {
    const matrix = buildCompatibilityMatrix(
      [
        analyzer("a", [Language.SOLIDITY], {
          rules: [
            rule("g001"),
            rule("g002", { since: "2.0.0", reason: "r" }),
            rule("g003", { since: "1.0.0", reason: "r", removedIn: "2.0.0" }),
          ],
        }),
      ],
      [],
      at,
    );

    expect(matrix.analyzers[0].ruleCount).toBe(3);
    expect(matrix.analyzers[0].deprecatedRuleCount).toBe(1);
    expect(matrix.analyzers[0].removedRuleCount).toBe(1);
  });

  it("survives an analyzer whose getRules throws", () => {
    const broken = analyzer("broken", [Language.SOLIDITY]);
    broken.getRules = () => {
      throw new Error("rule registry unavailable");
    };

    const matrix = buildCompatibilityMatrix([broken], [], at);
    expect(matrix.analyzers[0].ruleCount).toBe(0);
  });

  it("handles an empty analyzer set", () => {
    const matrix = buildCompatibilityMatrix([], [], at);
    expect(matrix.analyzers).toEqual([]);
    expect(matrix.languages).toEqual([]);
  });
});

describe("isMatrixHealthy", () => {
  it("tolerates overlap but not a coverage gap", () => {
    const overlapping = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY]), analyzer("b", [Language.SOLIDITY])],
      [],
      at,
    );
    expect(isMatrixHealthy(overlapping)).toBe(true);

    const gap = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY])],
      [Language.CAIRO],
      at,
    );
    expect(isMatrixHealthy(gap)).toBe(false);
  });
});

describe("renderMatrixMarkdown", () => {
  it("renders a table with a tick per supported language", () => {
    const matrix = buildCompatibilityMatrix(
      [
        analyzer("rust", [Language.RUST]),
        analyzer("solidity", [Language.SOLIDITY]),
      ],
      [],
      at,
    );
    const md = renderMatrixMarkdown(matrix);

    expect(md).toContain("| Analyzer | Version | rust | solidity |");
    expect(md).toContain("| rust | 1.0.0 | ✓ |  |");
    expect(md).toContain("| solidity | 1.0.0 |  | ✓ |");
  });

  it("lists issues beneath the table", () => {
    const matrix = buildCompatibilityMatrix(
      [analyzer("a", [Language.SOLIDITY])],
      [Language.CAIRO],
      at,
    );
    expect(renderMatrixMarkdown(matrix)).toContain("uncovered-language");
  });

  it("is deterministic, so a committed doc does not churn", () => {
    // The timestamp is deliberately excluded from the rendered table.
    const build = () =>
      buildCompatibilityMatrix(
        [analyzer("b", [Language.RUST]), analyzer("a", [Language.SOLIDITY])],
        [],
        () => new Date(),
      );
    expect(renderMatrixMarkdown(build())).toBe(renderMatrixMarkdown(build()));
  });
});
