import { createOrganizationPolicyFixtures, policyRuleIds } from './policy.fixtures';
import { resolveOrganizationPolicy, validateOrganizationPolicies } from './policy';

describe('organization policy inheritance', () => {
  it('inherits unspecified rules and applies child overrides', () => {
    const resolved = resolveOrganizationPolicy('team-overrides', createOrganizationPolicyFixtures());
    expect(resolved.rules).toEqual([
      { ruleId: 'reentrancy-guard', enabled: true, severity: 'critical' },
      { ruleId: 'uint8-vs-uint256', enabled: true },
    ]);
    expect(resolved.conflicts[0]).toMatchObject({
      policyId: 'team-overrides', inheritedFrom: 'org-defaults', ruleId: 'reentrancy-guard',
      field: 'severity', inheritedValue: 'high', overrideValue: 'critical',
    });
  });

  it('reports unknown references, parents, and policy ids', () => {
    expect(() => resolveOrganizationPolicy('missing', [])).toThrow('Unknown organization policy');
    const result = validateOrganizationPolicies([
      { id: 'team', organizationId: 'acme', parentPolicyId: 'missing', rules: [{ ruleId: 'unknown', enabled: true }] },
    ], policyRuleIds);
    expect(result.errors.map(({ code }) => code)).toEqual(['UNKNOWN_POLICY_RULE', 'UNKNOWN_PARENT_POLICY']);
  });

  it('rejects cycles, duplicate identifiers, and malformed overrides', () => {
    const cycle = [
      { id: 'a', organizationId: 'acme', parentPolicyId: 'b', rules: [] },
      { id: 'b', organizationId: 'acme', parentPolicyId: 'a', rules: [] },
    ];
    expect(validateOrganizationPolicies(cycle).errors.some(({ code }) => code === 'POLICY_INHERITANCE_CYCLE')).toBe(true);
    expect(() => resolveOrganizationPolicy('a', cycle)).toThrow('inheritance cycle');

    const invalid = validateOrganizationPolicies([
      { id: 'duplicate', organizationId: 'acme', rules: [{ ruleId: 'r', enabled: 'yes' }, { ruleId: 'r', enabled: false }] },
      { id: 'duplicate', organizationId: 'acme', rules: [] },
    ]);
    expect(invalid.errors.map(({ code }) => code)).toEqual([
      'INVALID_POLICY_RULE_ENABLED', 'DUPLICATE_POLICY_RULE', 'DUPLICATE_POLICY_ID',
    ]);
  });

  it('warns when inherited settings are overridden', () => {
    const result = validateOrganizationPolicies(createOrganizationPolicyFixtures(), policyRuleIds);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map(({ code }) => code)).toEqual(['POLICY_OVERRIDE_CONFLICT']);
  });
});