import type { AnalyzerConfig, Rule } from "./analyzer-interface";

/**
 * Rule deprecation lifecycle (#1024).
 *
 * Rules cannot be deleted the moment they stop being useful: configs in the
 * wild reference them by id, and a rule that vanishes turns someone's pinned
 * config into a silent no-op. This gives a rule a documented path —
 * active → deprecated → removed — so consumers get warned before anything
 * stops working.
 */

export type RuleLifecycleStage = "active" | "deprecated" | "removed";

export interface RuleDeprecation {
  /** Version in which the rule was deprecated. */
  since: string;
  /** Why, in terms a config author can act on. */
  reason: string;
  /** Rule id that supersedes this one, when there is a direct replacement. */
  replacedBy?: string;
  /** Version in which the rule is scheduled to stop working. */
  removeIn?: string;
  /** Set once the rule no longer runs. */
  removedIn?: string;
}

/** A rule carrying optional lifecycle metadata. */
export type LifecycleRule = Rule & { deprecation?: RuleDeprecation };

/** Current stage of a rule. */
export function lifecycleStage(rule: LifecycleRule): RuleLifecycleStage {
  if (!rule.deprecation) return "active";
  return rule.deprecation.removedIn ? "removed" : "deprecated";
}

export function isDeprecated(rule: LifecycleRule): boolean {
  return lifecycleStage(rule) === "deprecated";
}

export function isRemoved(rule: LifecycleRule): boolean {
  return lifecycleStage(rule) === "removed";
}

/**
 * Whether a rule should actually execute.
 *
 * A deprecated rule still runs — that is the whole point of a deprecation
 * period. Only a removed rule stops.
 */
export function isExecutable(rule: LifecycleRule): boolean {
  return !isRemoved(rule);
}

export interface LifecycleWarning {
  ruleId: string;
  stage: RuleLifecycleStage;
  message: string;
  replacedBy?: string;
}

/** Human-readable explanation for a deprecated or removed rule. */
export function describeLifecycle(rule: LifecycleRule): string | null {
  const deprecation = rule.deprecation;
  if (!deprecation) return null;

  const replacement = deprecation.replacedBy
    ? ` Use "${deprecation.replacedBy}" instead.`
    : "";

  if (deprecation.removedIn) {
    return (
      `Rule "${rule.id}" was removed in ${deprecation.removedIn} and no longer runs. ` +
      `${deprecation.reason}${replacement}`
    );
  }

  const removal = deprecation.removeIn
    ? ` It is scheduled for removal in ${deprecation.removeIn}.`
    : "";

  return (
    `Rule "${rule.id}" has been deprecated since ${deprecation.since}. ` +
    `${deprecation.reason}${replacement}${removal}`
  );
}

/** True when the config names this rule explicitly, at any setting. */
function configMentions(
  config: AnalyzerConfig | undefined,
  ruleId: string,
): boolean {
  const entry = config?.rules?.[ruleId];
  return entry !== undefined;
}

/** True when the config explicitly turns this rule on. */
function configEnables(
  config: AnalyzerConfig | undefined,
  ruleId: string,
): boolean {
  const entry = config?.rules?.[ruleId];
  if (entry === undefined) return false;
  if (typeof entry === "boolean") return entry;
  return entry.enabled;
}

/**
 * Warnings for lifecycle-affected rules a config references.
 *
 * Only rules the config *names* produce warnings. Warning about every
 * deprecated rule in the catalogue would bury the ones the user can actually
 * act on, and most consumers never touch the majority of rules.
 */
export function collectLifecycleWarnings(
  rules: LifecycleRule[],
  config?: AnalyzerConfig,
): LifecycleWarning[] {
  const warnings: LifecycleWarning[] = [];

  for (const rule of rules) {
    const stage = lifecycleStage(rule);
    if (stage === "active") continue;
    if (!configMentions(config, rule.id)) continue;

    // A config that explicitly disables an already-removed rule is harmless
    // and does not need pointing out.
    if (stage === "removed" && !configEnables(config, rule.id)) continue;

    const message = describeLifecycle(rule);
    if (!message) continue;

    warnings.push({
      ruleId: rule.id,
      stage,
      message,
      replacedBy: rule.deprecation?.replacedBy,
    });
  }

  return warnings;
}

/**
 * Rules that should run, given the config.
 *
 * Removed rules are dropped regardless of what the config says: re-enabling
 * something that no longer exists must not resurrect it.
 */
export function selectExecutableRules(
  rules: LifecycleRule[],
  config?: AnalyzerConfig,
): LifecycleRule[] {
  return rules.filter((rule) => {
    if (!isExecutable(rule)) return false;

    const entry = config?.rules?.[rule.id];
    if (entry === undefined) return rule.enabled;
    if (typeof entry === "boolean") return entry;
    return entry.enabled;
  });
}

/**
 * Resolves a rule id through its replacement chain.
 *
 * Guards against a cycle rather than looping forever — a bad metadata edit
 * should surface as an unresolved id, not a hang.
 */
export function resolveReplacement(
  rules: LifecycleRule[],
  ruleId: string,
  maxHops = 10,
): string {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const seen = new Set<string>([ruleId]);
  let current = ruleId;

  for (let hop = 0; hop < maxHops; hop++) {
    const replacement = byId.get(current)?.deprecation?.replacedBy;
    if (!replacement || seen.has(replacement)) break;
    seen.add(replacement);
    current = replacement;
  }

  return current;
}
