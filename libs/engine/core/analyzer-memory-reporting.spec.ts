import { AnalyzerRegistry } from "./analyzer-registry";
import { BaseAnalyzer, AnalysisResult, Language } from "./analyzer-interface";

class MemoryTestAnalyzer extends BaseAnalyzer {
  getName = () => "mem-analyzer";
  getVersion = () => "1.0.0";
  getSupportedLanguages = () => [Language.RUST];
  supportsLanguage = (l: Language | string) => l === Language.RUST;
  getRules = () => [];
  analyze = async (): Promise<AnalysisResult> => ({
    findings: [],
    filesAnalyzed: 1,
    analysisTime: 5,
    analyzerVersion: "1.0.0",
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  });
}

describe("Analyzer Memory Usage Reporting (#1020)", () => {
  it("does not report memory by default when not configured", async () => {
    const analyzer = new MemoryTestAnalyzer();
    const files = new Map([["src/main.rs", "fn main() {}"]]);

    const result = await analyzer.analyzeMultiple(files);
    expect(result.memoryUsage).toBeUndefined();
  });

  it("reports memory metrics when reportMemoryUsage is enabled in analyzeMultiple", async () => {
    const analyzer = new MemoryTestAnalyzer();
    const files = new Map([
      ["src/lib.rs", "pub fn foo() {}"],
      ["src/main.rs", "fn main() {}"],
    ]);

    const result = await analyzer.analyzeMultiple(files, {
      reportMemoryUsage: true,
    });

    expect(result.memoryUsage).toBeDefined();
    expect(result.memoryUsage!.heapUsed).toBeGreaterThan(0);
    expect(result.memoryUsage!.heapTotal).toBeGreaterThan(0);
    expect(result.memoryUsage!.rss).toBeGreaterThan(0);
    expect(typeof result.memoryUsage!.delta).toBe("number");
  });

  it("reports memory usage via AnalyzerRegistry.analyze", async () => {
    const registry = new AnalyzerRegistry();
    registry.register(new MemoryTestAnalyzer());

    const result = await registry.analyze(
      "fn main() {}",
      "src/main.rs",
      Language.RUST,
      { reportMemoryUsage: true },
    );

    expect(result.memoryUsage).toBeDefined();
    expect(result.memoryUsage!.heapUsed).toBeGreaterThan(0);
    expect(result.memoryUsage!.rss).toBeGreaterThan(0);
  });

  it("merges memory reporting across multiple analyzers in registry", async () => {
    class SecondaryAnalyzer extends BaseAnalyzer {
      getName = () => "sec-analyzer";
      getVersion = () => "1.0.0";
      getSupportedLanguages = () => [Language.RUST];
      supportsLanguage = (l: Language | string) => l === Language.RUST;
      getRules = () => [];
      analyze = async (): Promise<AnalysisResult> => ({
        findings: [],
        filesAnalyzed: 1,
        analysisTime: 2,
        analyzerVersion: "1.0.0",
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      });
    }

    const registry = new AnalyzerRegistry();
    registry.register(new MemoryTestAnalyzer());
    registry.register(new SecondaryAnalyzer());

    const files = new Map([["src/main.rs", "fn main() {}"]]);
    const langMap = new Map([["src/main.rs", Language.RUST]]);

    const result = await registry.analyzeMultiple(files, langMap, {
      reportMemoryUsage: true,
    });

    expect(result.memoryUsage).toBeDefined();
    expect(result.memoryUsage!.heapUsed).toBeGreaterThan(0);
    expect(result.memoryUsage!.heapTotal).toBeGreaterThan(0);
  });
});
