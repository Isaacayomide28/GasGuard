import { AnalyzerRegistry } from "./analyzer-registry";
import {
  Analyzer,
  AnalysisResult,
  BaseAnalyzer,
  AnalyzerCapabilities,
  Language,
} from "./analyzer-interface";

const mockResult = (): AnalysisResult => ({
  findings: [],
  filesAnalyzed: 1,
  analysisTime: 0,
  analyzerVersion: "1.0.0",
  summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
});

class MockRustAnalyzer extends BaseAnalyzer {
  getName = () => "rust-analyzer";
  getVersion = () => "1.0.0";
  getSupportedLanguages = () => [Language.RUST];
  supportsLanguage = (l: Language | string) => l === Language.RUST;
  getRules = () => [];
  analyze = async (): Promise<AnalysisResult> => mockResult();
}

class MockCustomAnalyzer implements Analyzer {
  getName = () => "custom-analyzer";
  getVersion = () => "2.0.0";
  getSupportedLanguages = () => [Language.SOLIDITY];
  supportsLanguage = (l: Language | string) => l === Language.SOLIDITY;
  getRules = () => [];
  getRule = () => undefined;
  validateConfig = () => [];
  initialize = async () => undefined;
  dispose = async () => undefined;
  analyze = async (): Promise<AnalysisResult> => mockResult();
  analyzeMultiple = async (): Promise<AnalysisResult> => mockResult();

  getCapabilities(): AnalyzerCapabilities {
    return {
      incremental: false,
      memoryReporting: true,
      quickFix: true,
      customRules: true,
      languages: [Language.SOLIDITY],
    };
  }
}

describe("Analyzer Capability Discovery (#1017)", () => {
  it("provides default capabilities on BaseAnalyzer", () => {
    const analyzer = new MockRustAnalyzer();
    const capabilities = analyzer.getCapabilities();

    expect(capabilities.batchAnalysis).toBe(true);
    expect(capabilities.incremental).toBe(true);
    expect(capabilities.changedFilesOnly).toBe(true);
    expect(capabilities.memoryReporting).toBe(true);
    expect(capabilities.configurableRules).toBe(true);
    expect(capabilities.languages).toEqual([Language.RUST]);
  });

  it("allows custom analyzer to declare bespoke capabilities", () => {
    const custom = new MockCustomAnalyzer();
    const capabilities = custom.getCapabilities();

    expect(capabilities.incremental).toBe(false);
    expect(capabilities.memoryReporting).toBe(true);
    expect(capabilities.quickFix).toBe(true);
    expect(capabilities.customRules).toBe(true);
    expect(capabilities.languages).toEqual([Language.SOLIDITY]);
  });

  it("discovers capabilities for all registered analyzers in registry", () => {
    const registry = new AnalyzerRegistry();
    registry.register(new MockRustAnalyzer());
    registry.register(new MockCustomAnalyzer());

    const discovered = registry.discoverCapabilities();
    expect(discovered.size).toBe(2);
    expect(discovered.get("rust-analyzer")?.incremental).toBe(true);
    expect(discovered.get("custom-analyzer")?.incremental).toBe(false);
    expect(discovered.get("custom-analyzer")?.quickFix).toBe(true);
  });

  it("retrieves capabilities by analyzer name", () => {
    const registry = new AnalyzerRegistry();
    registry.register(new MockRustAnalyzer());

    expect(registry.getCapabilities("rust-analyzer")?.memoryReporting).toBe(
      true,
    );
    expect(registry.getCapabilities("non-existent")).toBeUndefined();
  });

  it("checks whether an analyzer supports a specific capability", () => {
    const registry = new AnalyzerRegistry();
    registry.register(new MockRustAnalyzer());
    registry.register(new MockCustomAnalyzer());

    expect(registry.hasCapability("rust-analyzer", "incremental")).toBe(true);
    expect(registry.hasCapability("custom-analyzer", "incremental")).toBe(
      false,
    );
    expect(registry.hasCapability("custom-analyzer", "quickFix")).toBe(true);
    expect(registry.hasCapability("non-existent", "quickFix")).toBe(false);
  });

  it("filters analyzers matching a capability", () => {
    const registry = new AnalyzerRegistry();
    registry.register(new MockRustAnalyzer());
    registry.register(new MockCustomAnalyzer());

    const incrementalAnalyzers =
      registry.findAnalyzersByCapability("incremental");
    expect(incrementalAnalyzers.map((a) => a.getName())).toEqual([
      "rust-analyzer",
    ]);

    const quickFixAnalyzers = registry.findAnalyzersByCapability("quickFix");
    expect(quickFixAnalyzers.map((a) => a.getName())).toEqual([
      "custom-analyzer",
    ]);

    const memoryReportingAnalyzers =
      registry.findAnalyzersByCapability("memoryReporting");
    expect(memoryReportingAnalyzers.map((a) => a.getName())).toEqual([
      "rust-analyzer",
      "custom-analyzer",
    ]);
  });
});
