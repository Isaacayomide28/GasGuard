import { AnalyzerRegistry } from "./analyzer-registry";
import {
  BaseAnalyzer,
  AnalysisResult,
  Finding,
  Language,
  Severity,
} from "./analyzer-interface";

class ChangedFileTrackingAnalyzer extends BaseAnalyzer {
  public analyzedFiles: string[] = [];

  getName = () => "changed-file-analyzer";
  getVersion = () => "1.0.0";
  getSupportedLanguages = () => [Language.SOLIDITY];
  supportsLanguage = (l: Language | string) => l === Language.SOLIDITY;
  getRules = () => [];

  analyze = async (
    _code: string,
    filePath: string,
  ): Promise<AnalysisResult> => {
    this.analyzedFiles.push(filePath);
    const findings: Finding[] = [
      {
        ruleId: "sol-dummy",
        message: "Dummy finding",
        severity: Severity.LOW,
        location: { file: filePath, startLine: 1, endLine: 1 },
      },
    ];
    return {
      findings,
      filesAnalyzed: 1,
      analysisTime: 1,
      analyzerVersion: "1.0.0",
      summary: { critical: 0, high: 0, medium: 0, low: 1, info: 0 },
    };
  };
}

describe("Changed-File Analysis Mode (#1022)", () => {
  it("restricts analysis exclusively to changed files when enabled", async () => {
    const analyzer = new ChangedFileTrackingAnalyzer();
    const files = new Map([
      ["src/Token.sol", "contract Token {}"],
      ["src/Vault.sol", "contract Vault {}"],
      ["src/Governor.sol", "contract Governor {}"],
    ]);

    const result = await analyzer.analyzeMultiple(files, {
      changedFilesOnly: true,
      changedFiles: ["src/Vault.sol"],
    });

    expect(analyzer.analyzedFiles).toEqual(["src/Vault.sol"]);
    expect(result.filesAnalyzed).toBe(1);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.location.file).toBe("src/Vault.sol");
  });

  it("handles empty changed files list by skipping all files", async () => {
    const analyzer = new ChangedFileTrackingAnalyzer();
    const files = new Map([["src/Token.sol", "contract Token {}"]]);

    const result = await analyzer.analyzeMultiple(files, {
      changedFilesOnly: true,
      changedFiles: [],
    });

    expect(analyzer.analyzedFiles.length).toBe(0);
    expect(result.filesAnalyzed).toBe(0);
    expect(result.findings.length).toBe(0);
  });

  it("normalizes path separators between changedFiles and scanned files", async () => {
    const analyzer = new ChangedFileTrackingAnalyzer();
    const files = new Map([["src\\contracts\\Token.sol", "contract Token {}"]]);

    const result = await analyzer.analyzeMultiple(files, {
      changedFilesOnly: true,
      changedFiles: ["./src/contracts/Token.sol"],
    });

    expect(result.filesAnalyzed).toBe(1);
    expect(analyzer.analyzedFiles.length).toBe(1);
  });

  it("respects includePaths along with changedFilesOnly", async () => {
    const analyzer = new ChangedFileTrackingAnalyzer();
    const files = new Map([
      ["contracts/Token.sol", "contract Token {}"],
      ["test/Token.t.sol", "contract TokenTest {}"],
    ]);

    // Changed file is in test/, but includePaths only allows contracts/**
    const result = await analyzer.analyzeMultiple(files, {
      changedFilesOnly: true,
      changedFiles: ["test/Token.t.sol"],
      includePaths: ["contracts/**"],
    });

    expect(result.filesAnalyzed).toBe(0);
    expect(analyzer.analyzedFiles.length).toBe(0);
  });

  it("runs changed-file analysis via AnalyzerRegistry.analyzeChangedFiles helper", async () => {
    const analyzer = new ChangedFileTrackingAnalyzer();
    const registry = new AnalyzerRegistry();
    registry.register(analyzer);

    const files = new Map([
      ["src/A.sol", "contract A {}"],
      ["src/B.sol", "contract B {}"],
    ]);
    const langMap = new Map([
      ["src/A.sol", Language.SOLIDITY],
      ["src/B.sol", Language.SOLIDITY],
    ]);

    const result = await registry.analyzeChangedFiles(
      files,
      ["src/B.sol"],
      langMap,
    );

    expect(analyzer.analyzedFiles).toEqual(["src/B.sol"]);
    expect(result.filesAnalyzed).toBe(1);
    expect(result.findings[0]?.location.file).toBe("src/B.sol");
  });
});
