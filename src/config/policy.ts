import type { OrganizationPolicy, PolicyRuleOverride } from './config.types';

export interface PolicyConflict {
  policyId: string;
  inheritedFrom: string;
  ruleId: string;
  field: 'enabled' | 'severity';
  inheritedValue: boolean | string;
  overrideValue: boolean | string;
}

export interface ResolvedOrganizationPolicy {
  id: string;
  organizationId: string;
  rules: PolicyRuleOverride[];
  conflicts: PolicyConflict[];
}

export interface PolicyValidationResult {
  errors: Array<{ path: string; message: string; code: string }>;
  warnings: Array<{ path: string; message: string; code: string }>;
}

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

export function resolveOrganizationPolicy(
  policyId: string,
  policies: readonly OrganizationPolicy[],
): ResolvedOrganizationPolicy {
  const byId = new Map(policies.map((policy) => [policy.id, policy]));
  const target = byId.get(policyId);
  if (!target) throw new Error(`Unknown organization policy "${policyId}"`);

  const chain: OrganizationPolicy[] = [];
  const visiting = new Set<string>();
  let current: OrganizationPolicy | undefined = target;
  while (current) {
    if (visiting.has(current.id)) throw new Error(`Organization policy inheritance cycle at "${current.id}"`);
    visiting.add(current.id);
    chain.unshift(current);
    if (!current.parentPolicyId) break;
    const parentId = current.parentPolicyId;
    current = byId.get(parentId);
    if (!current) throw new Error(`Unknown parent policy "${parentId}"`);
  }

  const rules = new Map<string, PolicyRuleOverride>();
  const sources = new Map<string, Map<'enabled' | 'severity', string>>();
  const conflicts: PolicyConflict[] = [];
  for (const policy of chain) {
    for (const override of policy.rules) {
      const inherited = rules.get(override.ruleId);
      const fieldSources = sources.get(override.ruleId) ?? new Map();
      for (const field of ['enabled', 'severity'] as const) {
        const incoming = override[field];
        const existing = inherited?.[field];
        const inheritedFrom = fieldSources.get(field);
        if (incoming !== undefined && existing !== undefined && incoming !== existing && inheritedFrom) {
          conflicts.push({ policyId: policy.id, inheritedFrom, ruleId: override.ruleId, field, inheritedValue: existing, overrideValue: incoming });
        }
        if (incoming !== undefined) fieldSources.set(field, policy.id);
      }
      sources.set(override.ruleId, fieldSources);
      rules.set(override.ruleId, { ...inherited, ...override });
    }
  }

  return { id: target.id, organizationId: target.organizationId, rules: [...rules.values()], conflicts };
}

export function validateOrganizationPolicies(
  raw: unknown,
  ruleIds?: ReadonlySet<string>,
): PolicyValidationResult {
  const errors: PolicyValidationResult['errors'] = [];
  const warnings: PolicyValidationResult['warnings'] = [];
  if (!Array.isArray(raw)) {
    errors.push({ path: 'policies', message: '"policies" must be an array', code: 'INVALID_POLICIES_TYPE' });
    return { errors, warnings };
  }

  const policies = raw as unknown[];
  const byId = new Map<string, Record<string, unknown>>();
  policies.forEach((value, index) => {
    const policyPath = `policies[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ path: policyPath, message: 'Each policy must be an object', code: 'INVALID_POLICY_TYPE' });
      return;
    }
    const policy = value as Record<string, unknown>;
    if (typeof policy.id !== 'string' || !policy.id.trim()) {
      errors.push({ path: `${policyPath}.id`, message: 'Policy id must be a non-empty string', code: 'INVALID_POLICY_ID' });
    } else if (byId.has(policy.id)) {
      errors.push({ path: `${policyPath}.id`, message: `Duplicate policy id "${policy.id}"`, code: 'DUPLICATE_POLICY_ID' });
    } else {
      byId.set(policy.id, policy);
    }
    if (typeof policy.organizationId !== 'string' || !policy.organizationId.trim()) {
      errors.push({ path: `${policyPath}.organizationId`, message: 'organizationId must be a non-empty string', code: 'INVALID_POLICY_ORGANIZATION' });
    }
    if (policy.parentPolicyId !== undefined && (typeof policy.parentPolicyId !== 'string' || !policy.parentPolicyId.trim())) {
      errors.push({ path: `${policyPath}.parentPolicyId`, message: 'parentPolicyId must be a non-empty string when provided', code: 'INVALID_PARENT_POLICY_ID' });
    }
    if (!Array.isArray(policy.rules)) {
      errors.push({ path: `${policyPath}.rules`, message: 'Policy rules must be an array', code: 'INVALID_POLICY_RULES' });
      return;
    }
    const seenRuleIds = new Set<string>();
    policy.rules.forEach((ruleValue, ruleIndex) => {
      const rulePath = `${policyPath}.rules[${ruleIndex}]`;
      if (!ruleValue || typeof ruleValue !== 'object' || Array.isArray(ruleValue)) {
        errors.push({ path: rulePath, message: 'Policy rule override must be an object', code: 'INVALID_POLICY_RULE' });
        return;
      }
      const rule = ruleValue as Record<string, unknown>;
      if (typeof rule.ruleId !== 'string' || !rule.ruleId.trim()) {
        errors.push({ path: `${rulePath}.ruleId`, message: 'ruleId must be a non-empty string', code: 'INVALID_POLICY_RULE_ID' });
      } else {
        if (seenRuleIds.has(rule.ruleId)) {
          errors.push({ path: `${rulePath}.ruleId`, message: `Duplicate rule override "${rule.ruleId}"`, code: 'DUPLICATE_POLICY_RULE' });
        }
        seenRuleIds.add(rule.ruleId);
        if (ruleIds && !ruleIds.has(rule.ruleId)) {
          errors.push({ path: `${rulePath}.ruleId`, message: `Unknown rule "${rule.ruleId}"`, code: 'UNKNOWN_POLICY_RULE' });
        }
      }
      if (typeof rule.enabled !== 'boolean') {
        errors.push({ path: `${rulePath}.enabled`, message: 'enabled must be a boolean', code: 'INVALID_POLICY_RULE_ENABLED' });
      }
      if (rule.severity !== undefined && (typeof rule.severity !== 'string' || !SEVERITIES.has(rule.severity))) {
        errors.push({ path: `${rulePath}.severity`, message: 'severity must be critical, high, medium, low, or info', code: 'INVALID_POLICY_RULE_SEVERITY' });
      }
    });
  });

  for (const [id, policy] of byId) {
    if (typeof policy.parentPolicyId === 'string' && !byId.has(policy.parentPolicyId)) {
      errors.push({ path: `policies.${id}.parentPolicyId`, message: `Unknown parent policy "${policy.parentPolicyId}"`, code: 'UNKNOWN_PARENT_POLICY' });
    }
  }

  if (errors.length === 0) {
    const typedPolicies = policies as OrganizationPolicy[];
    const reported = new Set<string>();
    for (const policy of typedPolicies) {
      let resolved: ResolvedOrganizationPolicy;
      try {
        resolved = resolveOrganizationPolicy(policy.id, typedPolicies);
      } catch (error) {
        const message = (error as Error).message;
        errors.push({ path: `policies.${policy.id}`, message, code: message.includes('cycle') ? 'POLICY_INHERITANCE_CYCLE' : 'INVALID_POLICY_INHERITANCE' });
        continue;
      }
      for (const conflict of resolved.conflicts) {
        const key = `${conflict.policyId}:${conflict.ruleId}:${conflict.field}`;
        if (reported.has(key)) continue;
        reported.add(key);
        warnings.push({
          path: `policies.${conflict.policyId}.rules`,
          message: `Policy overrides inherited ${conflict.field} for rule "${conflict.ruleId}" from "${conflict.inheritedFrom}"; the child value takes precedence`,
          code: 'POLICY_OVERRIDE_CONFLICT',
        });
      }
    }
  }
  return { errors, warnings };
}