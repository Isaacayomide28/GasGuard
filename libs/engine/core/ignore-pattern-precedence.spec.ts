import { BaseAnalyzer, AnalysisResult, AnalyzerConfig, Language } from "./analyzer-interface";

class TestAnalyzer extends BaseAnalyzer {
  getName = () => "test";
  getVersion = () => "test";
  getSupportedLanguages = () => [Language.RUST];
  supportsLanguage = () => true;
  getRules = () => [];
  analyze = async (): Promise<AnalysisResult> => ({
    findings: [], filesAnalyzed: 0, analysisTime: 0, analyzerVersion: "test",
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  });
  accepts(path: string, config: AnalyzerConfig): boolean {
    return this.shouldAnalyzeFile(path, config);
  }
}

describe("ignore-pattern precedence", () => {
  const analyzer = new TestAnalyzer();

  it("lets the last matching rule win", () => {
    const config = { excludePaths: ["generated/**", "!generated/keep.rs"] };
    expect(analyzer.accepts("generated/drop.rs", config)).toBe(false);
    expect(analyzer.accepts("generated/keep.rs", config)).toBe(true);
  });

  it("allows a later ignore to override an earlier negation", () => {
    const config = { excludePaths: ["*.rs", "!src/**", "src/generated/**"] };
    expect(analyzer.accepts("src/lib.rs", config)).toBe(true);
    expect(analyzer.accepts("src/generated/code.rs", config)).toBe(false);
  });

  it("keeps includePaths as the outer allow-list", () => {
    const config = { includePaths: ["src/**"], excludePaths: ["!tests/**"] };
    expect(analyzer.accepts("tests/example.rs", config)).toBe(false);
  });

  it("normalizes Windows separators", () => {
    expect(analyzer.accepts("src\\generated\\code.rs", {
      excludePaths: ["src/generated/**"],
    })).toBe(false);
  });
});
