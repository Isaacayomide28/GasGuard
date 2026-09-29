import type { Analyzer, Language } from "./analyzer-interface";
import {
  isRemoved,
  lifecycleStage,
  type LifecycleRule,
} from "./rule-lifecycle";

/**
 * Analyzer compatibility matrix (#1025).
 *
 * Which analyzer covers which language is currently only discoverable by
 * calling every analyzer and comparing by hand. That makes two real problems
 * invisible: a language nothing analyzes (silently zero findings, which reads
 * as "clean"), and two analyzers claiming the same language without anyone
 * deciding that was intended.
 */

export interface AnalyzerCapability {
  analyzer: string;
  version: string;
  languages: string[];
  /** Analyzers that must run first, per `getDependencies()`. */
  dependencies: string[];
  ruleCount: number;
  deprecatedRuleCount: number;
  removedRuleCount: number;
}

export interface CompatibilityCell {
  analyzer: string;
  supported: boolean;
}

export interface CompatibilityMatrix {
  languages: string[];
  analyzers: AnalyzerCapability[];
  /** language -> analyzers claiming it. */
  coverage: Record<string, string[]>;
  issues: CompatibilityIssue[];
  generatedAt: string;
}

export type CompatibilityIssueKind =
  | "uncovered-language"
  | "overlapping-coverage"
  | "missing-dependency"
  | "no-languages";

export interface CompatibilityIssue {
  kind: CompatibilityIssueKind;
  message: string;
  language?: string;
  analyzers?: string[];
}

function rulesOf(analyzer: Analyzer): LifecycleRule[] {
  try {
    return (analyzer.getRules() ?? []) as LifecycleRule[];
  } catch {
    // A analyzer that cannot list its rules should not sink the whole matrix.
    return [];
  }
}

/**
 * Builds the matrix from a set of analyzers.
 *
 * `expectedLanguages` lets a caller assert coverage of languages the product
 * claims to support — without it, a language nobody analyzes simply never
 * appears and the gap stays invisible.
 */
export function buildCompatibilityMatrix(
  analyzers: Analyzer[],
  expectedLanguages: Array<Language | string> = [],
  now: () => Date = () => new Date(),
): CompatibilityMatrix {
  const capabilities: AnalyzerCapability[] = [];
  const coverage: Record<string, string[]> = {};
  const issues: CompatibilityIssue[] = [];

  for (const analyzer of analyzers) {
    const name = analyzer.getName();
    const languages = (analyzer.getSupportedLanguages() ?? []).map(String);
    const rules = rulesOf(analyzer);

    capabilities.push({
      analyzer: name,
      version: analyzer.getVersion(),
      languages: [...languages].sort(),
      dependencies: analyzer.getDependencies?.() ?? [],
      ruleCount: rules.length,
      deprecatedRuleCount: rules.filter(
        (r) => lifecycleStage(r) === "deprecated",
      ).length,
      removedRuleCount: rules.filter(isRemoved).length,
    });

    if (languages.length === 0) {
      issues.push({
        kind: "no-languages",
        message: `Analyzer "${name}" declares no supported languages, so it will never be selected.`,
        analyzers: [name],
      });
    }

    for (const language of languages) {
      (coverage[language] ??= []).push(name);
    }
  }

  // A language claimed by more than one analyzer is not necessarily wrong —
  // but it should be a decision, not an accident.
  for (const [language, owners] of Object.entries(coverage)) {
    if (owners.length > 1) {
      issues.push({
        kind: "overlapping-coverage",
        message:
          `Language "${language}" is claimed by ${owners.length} analyzers ` +
          `(${owners.join(", ")}). Confirm this overlap is intended.`,
        language,
        analyzers: [...owners].sort(),
      });
    }
  }

  for (const expected of expectedLanguages.map(String)) {
    if (!coverage[expected] || coverage[expected].length === 0) {
      issues.push({
        kind: "uncovered-language",
        message:
          `Language "${expected}" has no analyzer. Files in this language will ` +
          `produce zero findings, which is indistinguishable from being clean.`,
        language: expected,
      });
    }
  }

  // A declared dependency on an analyzer that is not registered means the
  // ordering guarantee cannot be honoured.
  const known = new Set(capabilities.map((c) => c.analyzer));
  for (const capability of capabilities) {
    for (const dependency of capability.dependencies) {
      if (!known.has(dependency)) {
        issues.push({
          kind: "missing-dependency",
          message:
            `Analyzer "${capability.analyzer}" depends on "${dependency}", ` +
            `which is not registered.`,
          analyzers: [capability.analyzer, dependency],
        });
      }
    }
  }

  const languages = [
    ...new Set([...Object.keys(coverage), ...expectedLanguages.map(String)]),
  ].sort();

  return {
    languages,
    analyzers: capabilities.sort((a, b) =>
      a.analyzer.localeCompare(b.analyzer),
    ),
    coverage,
    issues,
    generatedAt: now().toISOString(),
  };
}

/** True when the matrix has no problems worth failing a build over. */
export function isMatrixHealthy(matrix: CompatibilityMatrix): boolean {
  return matrix.issues.every((issue) => issue.kind === "overlapping-coverage");
}

/**
 * Renders the matrix as a Markdown table for documentation.
 *
 * Deliberately deterministic — analyzers and languages are sorted, and the
 * timestamp is excluded from the table — so a generated doc committed to the
 * repo does not churn on every run.
 */
export function renderMatrixMarkdown(matrix: CompatibilityMatrix): string {
  const header = `| Analyzer | Version | ${matrix.languages.join(" | ")} |`;
  const divider = `| --- | --- | ${matrix.languages.map(() => "---").join(" | ")} |`;

  const rows = matrix.analyzers.map((capability) => {
    const cells = matrix.languages.map((language) =>
      capability.languages.includes(language) ? "✓" : "",
    );
    return `| ${capability.analyzer} | ${capability.version} | ${cells.join(" | ")} |`;
  });

  const lines = [
    "# Analyzer compatibility matrix",
    "",
    header,
    divider,
    ...rows,
  ];

  if (matrix.issues.length > 0) {
    lines.push("", "## Issues", "");
    for (const issue of matrix.issues) {
      lines.push(`- **${issue.kind}** — ${issue.message}`);
    }
  }

  return lines.join("\n") + "\n";
}
