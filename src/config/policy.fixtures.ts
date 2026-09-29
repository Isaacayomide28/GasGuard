import type { OrganizationPolicy } from './validator';

export const policyRuleIds = new Set(['reentrancy-guard', 'uint8-vs-uint256']);

export function createOrganizationPolicyFixtures(): OrganizationPolicy[] {
  return [
    {
      id: 'org-defaults',
      organizationId: 'acme',
      rules: [
        { ruleId: 'reentrancy-guard', enabled: true, severity: 'high' },
        { ruleId: 'uint8-vs-uint256', enabled: true },
      ],
    },
    {
      id: 'team-overrides',
      organizationId: 'acme-platform',
      parentPolicyId: 'org-defaults',
      rules: [{ ruleId: 'reentrancy-guard', enabled: true, severity: 'critical' }],
    },
  ];
}