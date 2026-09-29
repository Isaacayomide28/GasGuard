import { AnalyzerRegistry } from "./analyzer-registry";
import { Analyzer, AnalysisResult, Language } from "./analyzer-interface";

const result = (): AnalysisResult => ({
  findings: [], filesAnalyzed: 1, analysisTime: 0, analyzerVersion: "test",
  summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
});

function analyzer(name: string, dependencies: string[] = [], calls: string[] = []): Analyzer {
  return {
    getName: () => name,
    getVersion: () => "test",
    getDependencies: () => dependencies,
    getSupportedLanguages: () => [Language.RUST],
    supportsLanguage: (language) => language === Language.RUST,
    getRules: () => [],
    getRule: () => undefined,
    validateConfig: () => [],
    initialize: async () => { calls.push(`init:${name}`); },
    dispose: async () => undefined,
    analyze: async () => { calls.push(`analyze:${name}`); return result(); },
    analyzeMultiple: async () => result(),
  };
}

describe("AnalyzerRegistry dependency ordering", () => {
  it("initializes and analyzes dependencies first", async () => {
    const calls: string[] = [];
    const registry = new AnalyzerRegistry();
    registry.register(analyzer("consumer", ["foundation"], calls));
    registry.register(analyzer("foundation", [], calls));

    await registry.initializeAll();
    await registry.analyze("", "lib.rs", Language.RUST);

    expect(calls).toEqual([
      "init:foundation", "init:consumer",
      "analyze:foundation", "analyze:consumer",
    ]);
  });

  it("rejects missing dependencies", () => {
    const registry = new AnalyzerRegistry();
    registry.register(analyzer("consumer", ["missing"]));
    expect(() => registry.getAnalyzersInDependencyOrder()).toThrow(
      'depends on unregistered analyzer "missing"',
    );
  });

  it("reports the dependency cycle", () => {
    const registry = new AnalyzerRegistry();
    registry.register(analyzer("a", ["b"]));
    registry.register(analyzer("b", ["a"]));
    expect(() => registry.getAnalyzersInDependencyOrder()).toThrow(
      "Circular analyzer dependency: a -> b -> a",
    );
  });
});
