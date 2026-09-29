# Analyzer Execution Modes and Capability Discovery

This document details the analyzer capabilities and execution modes introduced to enhance performance, observability, and flexibility across the GasGuard analyzer pipeline.

---

## 1. Analyzer Capability Discovery (#1017)

Analyzers declare their supported feature sets via the `AnalyzerCapabilities` interface. Callers and the central `AnalyzerRegistry` can discover and inspect capabilities at runtime to adapt analysis workflows.

### Capability Interface

```typescript
export interface AnalyzerCapabilities {
  incremental?: boolean;          // Supports incremental file-level analysis and caching
  changedFilesOnly?: boolean;     // Supports restricting analysis to changed files
  memoryReporting?: boolean;      // Supports reporting memory usage metrics
  batchAnalysis?: boolean;        // Supports analyzing multiple files in batches
  quickFix?: boolean;             // Supports providing automated or suggested fixes
  configurableRules?: boolean;    // Supports custom or dynamic rule configurations
  languages?: Language[];         // Supported programming languages
  [key: string]: any;             // Additional analyzer-specific capabilities
}
```

### Discovery APIs on `AnalyzerRegistry`

- `discoverCapabilities(): Map<string, AnalyzerCapabilities>`: Returns capabilities for all registered analyzers.
- `getCapabilities(name: string): AnalyzerCapabilities | undefined`: Returns declared capabilities of a specific analyzer.
- `hasCapability(name: string, capability: keyof AnalyzerCapabilities): boolean`: Checks whether an analyzer provides a specific capability.
- `findAnalyzersByCapability(capability: keyof AnalyzerCapabilities): Analyzer[]`: Returns all analyzers supporting the given capability.

### Example

```typescript
const registry = new AnalyzerRegistry();
registry.register(new SolidityAnalyzer());

const caps = registry.getCapabilities("SolidityAnalyzer");
if (caps?.incremental) {
  console.log("SolidityAnalyzer supports incremental analysis");
}

const incrementalAnalyzers = registry.findAnalyzersByCapability("incremental");
```

---

## 2. Analyzer Memory Usage Reporting (#1020)

Analyzers can monitor and report Node.js heap and process memory metrics consumed during analysis execution.

### Configuration

Enable memory reporting in `AnalyzerConfig`:

```typescript
const config: AnalyzerConfig = {
  reportMemoryUsage: true,
};
```

### Result Schema

When enabled, `AnalysisResult.memoryUsage` includes:

- `heapUsed`: Heap memory used in bytes.
- `heapTotal`: Total heap memory allocated in bytes.
- `rss`: Resident Set Size in bytes.
- `external`: Memory used by C++ objects bound to JavaScript (optional).
- `delta`: Net change in heap memory during the analysis run in bytes.

```typescript
const result = await registry.analyze(code, "Token.sol", Language.SOLIDITY, {
  reportMemoryUsage: true,
});

console.log(`Heap Used: ${result.memoryUsage?.heapUsed} bytes`);
console.log(`Net Heap Delta: ${result.memoryUsage?.delta} bytes`);
```

---

## 3. Incremental File-Level Analysis (#1021)

Incremental file-level analysis avoids re-analyzing unchanged files by maintaining a content-hash cache of findings and gas savings per file.

### Configuration

Enable incremental mode in `AnalyzerConfig`:

```typescript
const config: AnalyzerConfig = {
  incremental: true,
};
```

### Workflow and Statistics

1. **Initial Run**: All files are analyzed fresh and cached.
2. **Subsequent Runs**: Files whose content hash has not changed are served directly from cache without re-invoking analysis rules.
3. **Modified Files**: Only files whose hash differs from the cache are re-analyzed; existing unchanged files are served from cache.

`AnalysisResult.incremental` provides operational telemetry:

```typescript
export interface IncrementalAnalysisStats {
  cachedFiles: number;    // Number of files served from cache
  analyzedFiles: number;  // Number of files analyzed fresh
  totalFiles: number;     // Total number of files evaluated
}
```

### Cache Management

- `analyzer.clearCache()`: Clears the cache for an individual analyzer.
- `registry.clearAllCaches()`: Clears file caches across all registered analyzers.

---

## 4. Changed-File Analysis Mode (#1022)

Changed-file analysis restricts execution exclusively to files modified in a commit, PR, or working tree diff, skipping untouched codebase files.

### Configuration

```typescript
const config: AnalyzerConfig = {
  changedFilesOnly: true,
  changedFiles: ["contracts/Vault.sol", "contracts/Token.sol"],
};
```

Path separators (`/` and `\`) and leading `./` are automatically normalized. Files not present in `changedFiles` are ignored.

### Helper Method

`AnalyzerRegistry` provides a dedicated helper:

```typescript
const result = await registry.analyzeChangedFiles(
  filesMap,
  ["contracts/Vault.sol"],
  languageMap,
  { reportMemoryUsage: true, incremental: true }
);
```

---

## Troubleshooting

- **Incremental cache not hitting**: Ensure file contents match exactly; whitespace or comment changes alter the file hash and trigger a re-scan.
- **Changed-file mode scanning 0 files**: Verify that paths in `changedFiles` match relative file paths passed into `analyzeMultiple`.
- **Memory reporting returning undefined**: Ensure the runtime environment supports `process.memoryUsage()` (standard in Node.js).
