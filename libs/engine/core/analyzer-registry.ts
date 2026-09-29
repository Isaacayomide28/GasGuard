import {
  Analyzer,
  Language,
  AnalysisResult,
  AnalyzerConfig,
  Rule,
  AnalyzerCapabilities,
  MemoryUsage,
  IncrementalAnalysisStats,
} from "./analyzer-interface";

export class AnalyzerRegistry {
  private analyzers: Map<string, Analyzer> = new Map();
  private languageMap: Map<Language | string, Analyzer[]> = new Map();

  register(analyzer: Analyzer): void {
    const name = analyzer.getName();

    if (this.analyzers.has(name)) {
      throw new Error(`Analyzer with name "${name}" is already registered`);
    }

    this.analyzers.set(name, analyzer);

    // Update language map
    for (const language of analyzer.getSupportedLanguages()) {
      if (!this.languageMap.has(language)) {
        this.languageMap.set(language, []);
      }
      this.languageMap.get(language)!.push(analyzer);
    }
  }

  async unregister(name: string): Promise<void> {
    const analyzer = this.analyzers.get(name);

    if (!analyzer) {
      return;
    }

    await analyzer.dispose();

    this.analyzers.delete(name);

    for (const language of analyzer.getSupportedLanguages()) {
      const analyzers = this.languageMap.get(language);
      if (analyzers) {
        const index = analyzers.indexOf(analyzer);
        if (index !== -1) {
          analyzers.splice(index, 1);
        }
        if (analyzers.length === 0) {
          this.languageMap.delete(language);
        }
      }
    }
  }

  getAnalyzer(name: string): Analyzer | undefined {
    return this.analyzers.get(name);
  }

  getAnalyzersForLanguage(language: Language | string): Analyzer[] {
    return this.languageMap.get(language) || [];
  }

  getAllAnalyzers(): Analyzer[] {
    return Array.from(this.analyzers.values());
  }

  /**
   * Return analyzers in stable dependency order. Registration order is used
   * to break ties, making execution deterministic across runs.
   */
  getAnalyzersInDependencyOrder(
    analyzers: Analyzer[] = this.getAllAnalyzers(),
  ): Analyzer[] {
    const selected = new Map(
      analyzers.map((analyzer) => [analyzer.getName(), analyzer]),
    );
    const ordered: Analyzer[] = [];
    const visited = new Set<string>();
    const visiting: string[] = [];

    const visit = (analyzer: Analyzer): void => {
      const name = analyzer.getName();
      if (visited.has(name)) return;

      const cycleStart = visiting.indexOf(name);
      if (cycleStart !== -1) {
        throw new Error(
          `Circular analyzer dependency: ${[...visiting.slice(cycleStart), name].join(" -> ")}`,
        );
      }

      visiting.push(name);
      for (const dependencyName of analyzer.getDependencies?.() ?? []) {
        const dependency = this.analyzers.get(dependencyName);
        if (!dependency) {
          throw new Error(
            `Analyzer "${name}" depends on unregistered analyzer "${dependencyName}"`,
          );
        }
        // A language-specific run only includes dependencies that participate
        // in that run; global initialization still validates every dependency.
        if (selected.has(dependencyName)) visit(dependency);
      }
      visiting.pop();
      visited.add(name);
      ordered.push(analyzer);
    };

    for (const analyzer of analyzers) visit(analyzer);
    return ordered;
  }

  /**
   * Discover capabilities across all registered analyzers.
   */
  discoverCapabilities(): Map<string, AnalyzerCapabilities> {
    const capabilities = new Map<string, AnalyzerCapabilities>();
    for (const [name, analyzer] of this.analyzers.entries()) {
      capabilities.set(
        name,
        analyzer.getCapabilities?.() ?? {
          batchAnalysis: true,
          languages: analyzer.getSupportedLanguages(),
        },
      );
    }
    return capabilities;
  }

  /**
   * Get declared capabilities of a registered analyzer.
   */
  getCapabilities(analyzerName: string): AnalyzerCapabilities | undefined {
    const analyzer = this.getAnalyzer(analyzerName);
    if (!analyzer) {
      return undefined;
    }
    return (
      analyzer.getCapabilities?.() ?? {
        batchAnalysis: true,
        languages: analyzer.getSupportedLanguages(),
      }
    );
  }

  /**
   * Check whether a registered analyzer supports a given capability.
   */
  hasCapability(
    analyzerName: string,
    capability: keyof AnalyzerCapabilities,
  ): boolean {
    const caps = this.getCapabilities(analyzerName);
    return !!(caps && caps[capability]);
  }

  /**
   * Find all registered analyzers that provide a specific capability.
   */
  findAnalyzersByCapability(
    capability: keyof AnalyzerCapabilities,
  ): Analyzer[] {
    return this.getAllAnalyzers().filter((analyzer) => {
      const caps = analyzer.getCapabilities?.();
      return !!(caps && caps[capability]);
    });
  }

  /**
   * Clear file-level caches across all registered analyzers.
   */
  clearAllCaches(): void {
    for (const analyzer of this.analyzers.values()) {
      analyzer.clearCache?.();
    }
  }

  getSupportedLanguages(): Array<Language | string> {
    return Array.from(this.languageMap.keys());
  }

  isLanguageSupported(language: Language | string): boolean {
    return this.languageMap.has(language);
  }

  getAllRules(language?: Language | string): Rule[] {
    const analyzers = language
      ? this.getAnalyzersForLanguage(language)
      : this.getAllAnalyzers();

    const allRules: Rule[] = [];

    for (const analyzer of analyzers) {
      allRules.push(...analyzer.getRules());
    }

    return allRules;
  }

  async initializeAll(config?: AnalyzerConfig): Promise<void> {
    for (const analyzer of this.getAnalyzersInDependencyOrder()) {
      await analyzer.initialize(config);
    }
  }

  async disposeAll(): Promise<void> {
    const promises = Array.from(this.analyzers.values()).map((analyzer) =>
      analyzer.dispose(),
    );

    await Promise.all(promises);

    this.analyzers.clear();
    this.languageMap.clear();
  }

  async analyze(
    code: string,
    filePath: string,
    language: Language | string,
    config?: AnalyzerConfig,
    analyzerName?: string,
  ): Promise<AnalysisResult> {
    const startMemory =
      config?.reportMemoryUsage &&
      typeof process !== "undefined" &&
      process.memoryUsage
        ? process.memoryUsage()
        : undefined;

    let analyzers: Analyzer[];

    if (analyzerName) {
      const analyzer = this.getAnalyzer(analyzerName);
      if (!analyzer) {
        throw new Error(`Analyzer "${analyzerName}" not found`);
      }
      if (!analyzer.supportsLanguage(language)) {
        throw new Error(
          `Analyzer "${analyzerName}" does not support language "${language}"`,
        );
      }
      analyzers = [analyzer];
    } else {
      analyzers = this.getAnalyzersInDependencyOrder(
        this.getAnalyzersForLanguage(language),
      );
      if (analyzers.length === 0) {
        throw new Error(`No analyzer found for language "${language}"`);
      }
    }

    let result: AnalysisResult;
    if (analyzers.length === 1) {
      result = await analyzers[0]!.analyze(code, filePath, config);
    } else {
      const results: AnalysisResult[] = [];
      for (const analyzer of analyzers) {
        results.push(await analyzer.analyze(code, filePath, config));
      }
      result = this.mergeResults(results);
    }

    if (
      config?.reportMemoryUsage &&
      startMemory &&
      typeof process !== "undefined" &&
      process.memoryUsage &&
      !result.memoryUsage
    ) {
      const current = process.memoryUsage();
      result.memoryUsage = {
        heapUsed: current.heapUsed,
        heapTotal: current.heapTotal,
        rss: current.rss,
        external: current.external,
        delta: current.heapUsed - startMemory.heapUsed,
      };
    }

    return result;
  }

  async analyzeMultiple(
    files: Map<string, string>,
    languageMap: Map<string, Language | string>,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const startMemory =
      config?.reportMemoryUsage &&
      typeof process !== "undefined" &&
      process.memoryUsage
        ? process.memoryUsage()
        : undefined;

    // Group files by language
    const filesByLanguage = new Map<Language | string, Map<string, string>>();

    for (const [filePath, code] of files.entries()) {
      const language = languageMap.get(filePath);
      if (!language) {
        continue;
      }

      if (!filesByLanguage.has(language)) {
        filesByLanguage.set(language, new Map());
      }

      filesByLanguage.get(language)!.set(filePath, code);
    }

    // Analyze each language group
    const allResults: AnalysisResult[] = [];

    for (const [language, languageFiles] of filesByLanguage.entries()) {
      const analyzers = this.getAnalyzersInDependencyOrder(
        this.getAnalyzersForLanguage(language),
      );

      for (const analyzer of analyzers) {
        const result = await analyzer.analyzeMultiple(languageFiles, config);
        allResults.push(result);
      }
    }

    // Merge all results
    const mergedResult = this.mergeResults(allResults);
    mergedResult.analysisTime = Date.now() - startTime;

    if (
      config?.reportMemoryUsage &&
      startMemory &&
      typeof process !== "undefined" &&
      process.memoryUsage &&
      !mergedResult.memoryUsage
    ) {
      const current = process.memoryUsage();
      mergedResult.memoryUsage = {
        heapUsed: current.heapUsed,
        heapTotal: current.heapTotal,
        rss: current.rss,
        external: current.external,
        delta: current.heapUsed - startMemory.heapUsed,
      };
    }

    return mergedResult;
  }

  /**
   * Convenience method to analyze only changed files.
   */
  async analyzeChangedFiles(
    files: Map<string, string>,
    changedFiles: string[],
    languageMap: Map<string, Language | string>,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult> {
    return this.analyzeMultiple(files, languageMap, {
      ...config,
      changedFilesOnly: true,
      changedFiles,
    });
  }

  private mergeResults(results: AnalysisResult[]): AnalysisResult {
    if (results.length === 0) {
      return {
        findings: [],
        filesAnalyzed: 0,
        analysisTime: 0,
        analyzerVersion: "registry-1.0.0",
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      };
    }

    if (results.length === 1) {
      return results[0]!;
    }

    const allFindings = results.flatMap((r) => r.findings);
    allFindings.sort((a, b) => {
      const sevOrder: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
      };
      const fileA = a.location?.file ?? (a as any).file ?? "";
      const fileB = b.location?.file ?? (b as any).file ?? "";
      const lineA = a.location?.startLine ?? (a as any).line ?? 0;
      const lineB = b.location?.startLine ?? (b as any).line ?? 0;
      const ruleA = a.ruleId ?? (a as any).rule ?? "";
      const ruleB = b.ruleId ?? (b as any).rule ?? "";

      return (
        (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5) ||
        fileA.localeCompare(fileB) ||
        lineA - lineB ||
        ruleA.localeCompare(ruleB)
      );
    });

    const allErrors = results.flatMap((r) => r.errors || []);
    const totalFiles = results.reduce((sum, r) => sum + r.filesAnalyzed, 0);
    const totalTime = results.reduce((sum, r) => sum + r.analysisTime, 0);
    const totalGasSavings = results.reduce(
      (sum, r) => sum + (r.totalEstimatedGasSavings || 0),
      0,
    );

    let memoryUsage: MemoryUsage | undefined;
    const resultsWithMem = results.filter((r) => r.memoryUsage);
    if (resultsWithMem.length > 0) {
      memoryUsage = {
        heapUsed: Math.max(
          ...resultsWithMem.map((r) => r.memoryUsage!.heapUsed),
        ),
        heapTotal: Math.max(
          ...resultsWithMem.map((r) => r.memoryUsage!.heapTotal),
        ),
        rss: Math.max(...resultsWithMem.map((r) => r.memoryUsage!.rss)),
        external: Math.max(
          ...resultsWithMem.map((r) => r.memoryUsage!.external ?? 0),
        ),
        delta: resultsWithMem.reduce(
          (sum, r) => sum + (r.memoryUsage!.delta ?? 0),
          0,
        ),
      };
    }

    let incremental: IncrementalAnalysisStats | undefined;
    const resultsWithInc = results.filter((r) => r.incremental);
    if (resultsWithInc.length > 0) {
      incremental = {
        cachedFiles: resultsWithInc.reduce(
          (sum, r) => sum + r.incremental!.cachedFiles,
          0,
        ),
        analyzedFiles: resultsWithInc.reduce(
          (sum, r) => sum + r.incremental!.analyzedFiles,
          0,
        ),
        totalFiles: Math.max(
          ...resultsWithInc.map((r) => r.incremental!.totalFiles),
        ),
      };
    }

    return {
      findings: allFindings,
      filesAnalyzed: totalFiles,
      analysisTime: totalTime,
      analyzerVersion: "registry-1.0.0",
      summary: {
        critical: allFindings.filter((f) => f.severity === "critical").length,
        high: allFindings.filter((f) => f.severity === "high").length,
        medium: allFindings.filter((f) => f.severity === "medium").length,
        low: allFindings.filter((f) => f.severity === "low").length,
        info: allFindings.filter((f) => f.severity === "info").length,
      },
      totalEstimatedGasSavings:
        totalGasSavings > 0 ? totalGasSavings : undefined,
      errors: allErrors.length > 0 ? allErrors : undefined,
      memoryUsage,
      incremental,
    };
  }
}
