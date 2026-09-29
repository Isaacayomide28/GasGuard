import type { AnalysisResult, AnalyzerConfig } from "./analyzer-interface";

/**
 * Analyzer timeout handling and diagnostics (#1019).
 *
 * A single analyzer that never settles takes the whole run with it: the
 * caller gets no findings at all, not even from the analyzers that finished.
 * Worse, it does so silently — there is nothing in the result to say which
 * analyzer hung or on what. This bounds each analyzer and turns an overrun
 * into a structured diagnostic that survives into the result.
 */

/** Default per-analyzer budget when none is configured. */
export const DEFAULT_ANALYZER_TIMEOUT_MS = 30_000;

/** Why an analyzer did not produce a result. */
export type AnalyzerFailureKind = "timeout" | "error";

export interface AnalyzerDiagnostic {
  kind: AnalyzerFailureKind;
  analyzer: string;
  analyzerVersion?: string;
  /** Milliseconds actually spent before giving up or failing. */
  elapsedMs: number;
  /** The budget that was exceeded. Only set for timeouts. */
  timeoutMs?: number;
  /** Files the analyzer was working on, to make the overrun reproducible. */
  files: string[];
  message: string;
}

/** Raised when an analyzer exceeds its budget. */
export class AnalyzerTimeoutError extends Error {
  readonly diagnostic: AnalyzerDiagnostic;

  constructor(diagnostic: AnalyzerDiagnostic) {
    super(diagnostic.message);
    this.name = "AnalyzerTimeoutError";
    this.diagnostic = diagnostic;
  }
}

/**
 * Resolves the timeout for a run.
 *
 * A non-positive or non-finite value disables the limit rather than making
 * every analyzer fail instantly, which is the failure mode a `0` default
 * would otherwise produce.
 */
export function resolveTimeoutMs(
  config?: AnalyzerConfig & { timeoutMs?: number },
): number | null {
  const configured = config?.timeoutMs;
  if (configured === undefined || configured === null) {
    return DEFAULT_ANALYZER_TIMEOUT_MS;
  }
  if (!Number.isFinite(configured) || configured <= 0) return null;
  return configured;
}

/** Truncates a file list so a diagnostic cannot become unbounded. */
function summariseFiles(files: string[], limit = 10): string[] {
  if (files.length <= limit) return [...files];
  return [...files.slice(0, limit), `… and ${files.length - limit} more`];
}

export interface RunWithTimeoutOptions {
  analyzer: string;
  analyzerVersion?: string;
  files: string[];
  timeoutMs: number | null;
  /** Injected for deterministic tests. */
  now?: () => number;
}

/**
 * Runs an analyzer call under a time budget.
 *
 * Rejects with `AnalyzerTimeoutError` when the budget is exceeded. The
 * underlying promise is *not* cancellable — JavaScript has no way to abort it
 * — so the timer is cleared on settle to avoid keeping the process alive, and
 * a late result is simply discarded. This is deliberate: we would rather
 * report the overrun promptly than block waiting for a call that may never
 * return.
 */
export async function runWithTimeout<T>(
  work: () => Promise<T>,
  options: RunWithTimeoutOptions,
): Promise<T> {
  const now = options.now ?? (() => Date.now());
  const started = now();

  if (options.timeoutMs === null) {
    return work();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new AnalyzerTimeoutError({
          kind: "timeout",
          analyzer: options.analyzer,
          analyzerVersion: options.analyzerVersion,
          elapsedMs: now() - started,
          timeoutMs: options.timeoutMs ?? undefined,
          files: summariseFiles(options.files),
          message:
            `Analyzer "${options.analyzer}" exceeded its ${options.timeoutMs}ms budget ` +
            `while analyzing ${options.files.length} file(s).`,
        }),
      );
    }, options.timeoutMs);

    // Never hold the process open purely for a timeout.
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Builds a diagnostic for a non-timeout analyzer failure. */
export function toErrorDiagnostic(
  error: unknown,
  options: {
    analyzer: string;
    analyzerVersion?: string;
    files: string[];
    elapsedMs: number;
  },
): AnalyzerDiagnostic {
  return {
    kind: "error",
    analyzer: options.analyzer,
    analyzerVersion: options.analyzerVersion,
    elapsedMs: options.elapsedMs,
    files: summariseFiles(options.files),
    message:
      error instanceof Error
        ? error.message
        : `Analyzer "${options.analyzer}" failed: ${String(error)}`,
  };
}

/**
 * Folds a diagnostic into an `AnalysisResult.errors` entry.
 *
 * Keeping diagnostics in the existing `errors` channel means callers that
 * already surface analyzer errors pick timeouts up without any change.
 */
export function diagnosticToResultError(
  diagnostic: AnalyzerDiagnostic,
): NonNullable<AnalysisResult["errors"]>[number] {
  return {
    file: diagnostic.files[0] ?? "(multiple files)",
    message: diagnostic.message,
  };
}

/** An empty result, used when an analyzer produced nothing usable. */
export function emptyResult(analyzerVersion: string): AnalysisResult {
  return {
    findings: [],
    filesAnalyzed: 0,
    analysisTime: 0,
    analyzerVersion,
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  };
}
