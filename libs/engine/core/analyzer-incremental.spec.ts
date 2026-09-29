import { AnalyzerRegistry } from "./analyzer-registry";
import {
  BaseAnalyzer,
  AnalysisResult,
  Finding,
  Language,
  Severity,
} from "./analyzer-interface";

class CountingAnalyzer extends BaseAnalyzer {
  public analyzeCalls = 0;
  getName = () => "counting-analyzer";
  getVersion = () => "1.0.0";
  getSupportedLanguages = () => [Language.SOLIDITY];
  supportsLanguage = (l: Language | string) => l === Language.SOLIDITY;
  getRules = () => [];

  analyze = async (
    _code: string,
    filePath: string,
  ): Promise<AnalysisResult> => {
    this.analyzeCalls++;
    const findings: Finding[] = [
      {
        ruleId: "test-rule",
        message: `Issue found in ${filePath}`,
        severity: Severity.HIGH,
        location: {
          file: filePath,
          startLine: 1,
          endLine: 1,
        },
        estimatedGasSavings: 100,
      },
    ];
    return {
      findings,
      filesAnalyzed: 1,
      analysisTime: 2,
      analyzerVersion: "1.0.0",
      summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      totalEstimatedGasSavings: 100,
    };
  };
}

describe("Incremental File-Level Analysis (#1021)", () => {
  it("analyzes all files fresh on initial run with incremental mode enabled", async () => {
    const analyzer = new CountingAnalyzer();
    const files = new Map([
      ["contracts/A.sol", "contract A {}"],
      ["contracts/B.sol", "contract B {}"],
    ]);

    const result = await analyzer.analyzeMultiple(files, { incremental: true });

    expect(analyzer.analyzeCalls).toBe(2);
    expect(result.filesAnalyzed).toBe(2);
    expect(result.incremental).toEqual({
      cachedFiles: 0,
      analyzedFiles: 2,
      totalFiles: 2,
    });
    expect(result.findings.length).toBe(2);
  });

  it("serves unchanged files from cache on second run without re-running analyzer", async () => {
    const analyzer = new CountingAnalyzer();
    const files = new Map([
      ["contracts/A.sol", "contract A {}"],
      ["contracts/B.sol", "contract B {}"],
    ]);

    await analyzer.analyzeMultiple(files, { incremental: true });
    expect(analyzer.analyzeCalls).toBe(2);

    const secondResult = await analyzer.analyzeMultiple(files, {
      incremental: true,
    });

    // analyzeCalls should still be 2 because cache was hit
    expect(analyzer.analyzeCalls).toBe(2);
    expect(secondResult.filesAnalyzed).toBe(2);
    expect(secondResult.incremental).toEqual({
      cachedFiles: 2,
      analyzedFiles: 0,
      totalFiles: 2,
    });
    expect(secondResult.findings.length).toBe(2);
  });

  it("only analyzes modified file when one file changes in batch", async () => {
    const analyzer = new CountingAnalyzer();
    const files1 = new Map([
      ["contracts/A.sol", "contract A {}"],
      ["contracts/B.sol", "contract B {}"],
    ]);

    await analyzer.analyzeMultiple(files1, { incremental: true });
    expect(analyzer.analyzeCalls).toBe(2);

    const files2 = new Map([
      ["contracts/A.sol", "contract A { uint256 x; }"], // modified!
      ["contracts/B.sol", "contract B {}"], // unchanged!
    ]);

    const result2 = await analyzer.analyzeMultiple(files2, {
      incremental: true,
    });

    expect(analyzer.analyzeCalls).toBe(3); // only 1 new call
    expect(result2.incremental).toEqual({
      cachedFiles: 1,
      analyzedFiles: 1,
      totalFiles: 2,
    });
  });

  it("clears cache via clearCache() forcing fresh analysis", async () => {
    const analyzer = new CountingAnalyzer();
    const files = new Map([["contracts/A.sol", "contract A {}"]]);

    await analyzer.analyzeMultiple(files, { incremental: true });
    expect(analyzer.analyzeCalls).toBe(1);

    analyzer.clearCache();
    expect(analyzer.getCacheSize()).toBe(0);

    await analyzer.analyzeMultiple(files, { incremental: true });
    expect(analyzer.analyzeCalls).toBe(2);
  });

  it("supports clearAllCaches() on registry", async () => {
    const analyzer = new CountingAnalyzer();
    const registry = new AnalyzerRegistry();
    registry.register(analyzer);

    const files = new Map([["contracts/A.sol", "contract A {}"]]);
    const langMap = new Map([["contracts/A.sol", Language.SOLIDITY]]);

    await registry.analyzeMultiple(files, langMap, { incremental: true });
    expect(analyzer.getCacheSize()).toBe(1);

    registry.clearAllCaches();
    expect(analyzer.getCacheSize()).toBe(0);
  });

  it("normalizes Windows backslashes and forward slashes to same cache entry", async () => {
    const analyzer = new CountingAnalyzer();
    const filesWin = new Map([["contracts\\A.sol", "contract A {}"]]);
    const filesPosix = new Map([["contracts/A.sol", "contract A {}"]]);

    await analyzer.analyzeMultiple(filesWin, { incremental: true });
    expect(analyzer.analyzeCalls).toBe(1);

    const result = await analyzer.analyzeMultiple(filesPosix, {
      incremental: true,
    });
    expect(analyzer.analyzeCalls).toBe(1); // cache hit despite separator diff
    expect(result.incremental?.cachedFiles).toBe(1);
  });
});
