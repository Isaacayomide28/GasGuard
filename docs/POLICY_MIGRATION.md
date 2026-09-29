# Policy Migration Guide

GasGuard configuration continues to accept the existing `profiles` array. Organization policies are an optional, additive format for sharing rule settings across an organization hierarchy.

## Existing profiles

No migration is required for existing configurations. Profiles remain named collections of rule and system overrides and may continue to be used unchanged.

## Organization policies

Add a top-level `policies` array when policies need inheritance. Each policy has a unique `id`, an `organizationId`, a `rules` array, and an optional `parentPolicyId`. A child inherits parent rules; a child value for the same rule field takes precedence. Overrides that change an inherited value are reported as `POLICY_OVERRIDE_CONFLICT` warnings so the effective choice is visible.

```json
{
  "policies": [
    {
      "id": "company-defaults",
      "organizationId": "company",
      "rules": [{ "ruleId": "reentrancy-guard", "enabled": true, "severity": "high" }]
    },
    {
      "id": "payments-team",
      "organizationId": "company-payments",
      "parentPolicyId": "company-defaults",
      "rules": [{ "ruleId": "reentrancy-guard", "enabled": true, "severity": "critical" }]
    }
  ]
}
```

Policy identifiers must be unique, parent references must exist and be acyclic, and each `ruleId` must refer to a configured rule. Invalid references or malformed overrides fail configuration validation. To migrate a profile, create one organization policy, map each profile rule's `id` to `ruleId`, and associate it with the owning organization. Keep system-wide `systemOverrides` on profiles; organization policies currently govern rule enablement and severity only.

## Rollout

Introduce policies alongside profiles, validate the configuration, then switch organization-aware consumers to `resolveOrganizationPolicy`. Remove legacy profiles only after all consumers have moved. A policy without a parent is a standalone policy and requires no migration special case.