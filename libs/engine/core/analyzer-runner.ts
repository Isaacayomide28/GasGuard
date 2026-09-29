import type {
  Analyzer,
  AnalysisResult,
  AnalyzerConfig,
} from "./analyzer-interface";
import {
  AnalyzerTimeoutError,
  diagnosticToResultError,
  emptyResult,
  resolveTimeoutMs,
  runWithTimeout,
  toErrorDiagnostic,
  type AnalyzerDiagnostic,
} from "./analyzer-timeout";

/** Config accepted by the runner, extending the analyzer config. */
export type RunnerConfig = AnalyzerConfig & { timeoutMs?: number };

export interface RunOutcome {
  result: AnalysisResult;
  /** Present when the analyzer timed out or threw. */
  diagnostic?: AnalyzerDiagnostic;
}

/**
 * Runs one analyzer under a time budget, never throwing (#1019).
 *
 * The contract here is the point: a misbehaving analyzer degrades to an empty
 * result plus a diagnostic, rather than taking down the whole analysis. The
 * caller always gets something back and can see exactly what failed.
 */
export async function runAnalyzerSafely(
  analyzer: Analyzer,
  files: Map<string, string>,
  config?: RunnerConfig,
  now: () => number = () => Date.now(),
): Promise<RunOutcome> {
  const timeoutMs = resolveTimeoutMs(config);
  const filePaths = [...files.keys()];
  const started = now();

  try {
    const result = await runWithTimeout(
      () => analyzer.analyzeMultiple(files, config),
      {
        analyzer: analyzer.getName(),
        analyzerVersion: analyzer.getVersion(),
        files: filePaths,
        timeoutMs,
        now,
      },
    );
    return { result };
  } catch (error) {
    const diagnostic =
      error instanceof AnalyzerTimeoutError
        ? error.diagnostic
        : toErrorDiagnostic(error, {
            analyzer: analyzer.getName(),
            analyzerVersion: analyzer.getVersion(),
            files: filePaths,
            elapsedMs: now() - started,
          });

    const result = emptyResult(analyzer.getVersion());
    result.errors = [diagnosticToResultError(diagnostic)];
    return { result, diagnostic };
  }
}

export interface MultiRunOutcome {
  results: AnalysisResult[];
  diagnostics: AnalyzerDiagnostic[];
}

/**
 * Runs several analyzers, isolating each one's failure.
 *
 * Analyzers run sequentially so a shared timeout budget is not consumed by
 * contention between them, and so `getDependencies()` ordering decided by the
 * registry is preserved.
 */
export async function runAnalyzers(
  analyzers: Analyzer[],
  files: Map<string, string>,
  config?: RunnerConfig,
  now: () => number = () => Date.now(),
): Promise<MultiRunOutcome> {
  const results: AnalysisResult[] = [];
  const diagnostics: AnalyzerDiagnostic[] = [];

  for (const analyzer of analyzers) {
    const outcome = await runAnalyzerSafely(analyzer, files, config, now);
    results.push(outcome.result);
    if (outcome.diagnostic) diagnostics.push(outcome.diagnostic);
  }

  return { results, diagnostics };
}
