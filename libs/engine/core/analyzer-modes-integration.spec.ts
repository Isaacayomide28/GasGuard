import { AnalyzerRegistry } from "./analyzer-registry";
import {
  BaseAnalyzer,
  AnalysisResult,
  Finding,
  Language,
  Severity,
} from "./analyzer-interface";

class IntegratedSolidityAnalyzer extends BaseAnalyzer {
  public executionCount = 0;

  getName = () => "integrated-solidity";
  getVersion = () => "1.0.0";
  getSupportedLanguages = () => [Language.SOLIDITY];
  supportsLanguage = (l: Language | string) => l === Language.SOLIDITY;
  getRules = () => [];

  analyze = async (
    _code: string,
    filePath: string,
  ): Promise<AnalysisResult> => {
    this.executionCount++;
    const findings: Finding[] = [
      {
        ruleId: "sol-gas-save",
        message: "Gas optimization available",
        severity: Severity.MEDIUM,
        location: { file: filePath, startLine: 1, endLine: 2 },
        estimatedGasSavings: 250,
      },
    ];
    return {
      findings,
      filesAnalyzed: 1,
      analysisTime: 2,
      analyzerVersion: "1.0.0",
      summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
      totalEstimatedGasSavings: 250,
    };
  };
}

describe("Analyzer Modes and Capabilities Integration (#1017, #1020, #1021, #1022)", () => {
  it("combines capability discovery, changed-file filtering, incremental caching, and memory reporting", async () => {
    const registry = new AnalyzerRegistry();
    const analyzer = new IntegratedSolidityAnalyzer();
    registry.register(analyzer);

    // 1. Verify capability discovery (#1017)
    const capabilities = registry.getCapabilities("integrated-solidity");
    expect(capabilities?.incremental).toBe(true);
    expect(capabilities?.changedFilesOnly).toBe(true);
    expect(capabilities?.memoryReporting).toBe(true);
    expect(registry.hasCapability("integrated-solidity", "batchAnalysis")).toBe(
      true,
    );

    const files = new Map([
      ["src/Token.sol", "contract Token { uint256 a; }"],
      ["src/Vault.sol", "contract Vault { uint256 b; }"],
      ["src/Router.sol", "contract Router { uint256 c; }"],
    ]);
    const langMap = new Map([
      ["src/Token.sol", Language.SOLIDITY],
      ["src/Vault.sol", Language.SOLIDITY],
      ["src/Router.sol", Language.SOLIDITY],
    ]);

    // 2. Run with changed-file mode + incremental + memory reporting (#1020, #1021, #1022)
    // Only Token.sol and Vault.sol changed
    const run1 = await registry.analyzeMultiple(files, langMap, {
      changedFilesOnly: true,
      changedFiles: ["src/Token.sol", "src/Vault.sol"],
      incremental: true,
      reportMemoryUsage: true,
    });

    expect(analyzer.executionCount).toBe(2);
    expect(run1.filesAnalyzed).toBe(2);
    expect(run1.findings.length).toBe(2);
    expect(run1.memoryUsage).toBeDefined();
    expect(run1.memoryUsage!.heapUsed).toBeGreaterThan(0);
    expect(run1.incremental).toEqual({
      cachedFiles: 0,
      analyzedFiles: 2,
      totalFiles: 3,
    });

    // 3. Second run where only Token.sol is analyzed again without change
    const run2 = await registry.analyzeMultiple(files, langMap, {
      changedFilesOnly: true,
      changedFiles: ["src/Token.sol"],
      incremental: true,
      reportMemoryUsage: true,
    });

    // executionCount should still be 2 due to incremental cache hit!
    expect(analyzer.executionCount).toBe(2);
    expect(run2.filesAnalyzed).toBe(1);
    expect(run2.incremental).toEqual({
      cachedFiles: 1,
      analyzedFiles: 0,
      totalFiles: 3,
    });
    expect(run2.memoryUsage).toBeDefined();

    // 4. Modify Token.sol content and rerun
    const filesModified = new Map([
      ["src/Token.sol", "contract Token { uint256 a_modified; }"],
      ["src/Vault.sol", "contract Vault { uint256 b; }"],
      ["src/Router.sol", "contract Router { uint256 c; }"],
    ]);

    const run3 = await registry.analyzeMultiple(filesModified, langMap, {
      changedFilesOnly: true,
      changedFiles: ["src/Token.sol"],
      incremental: true,
    });

    // executionCount should increment by 1 for the modified Token.sol
    expect(analyzer.executionCount).toBe(3);
    expect(run3.filesAnalyzed).toBe(1);
    expect(run3.incremental).toEqual({
      cachedFiles: 0,
      analyzedFiles: 1,
      totalFiles: 3,
    });
  });
});
