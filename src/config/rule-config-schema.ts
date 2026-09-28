/**
 * Rule Configuration Schema Validation
 *
 * Validates individual rule configuration entries against the declarative
 * JSON Schema in src/schemas/rule-config.schema.json, so the accepted shape
 * of a RuleConfiguration lives in one schema file instead of being
 * re-implemented ad hoc at every call site.
 */

import { validateAgainstSchema } from '../schemas/json-schema-validator';
import ruleConfigSchema from '../schemas/rule-config.schema.json';
import { ConfigurationValidationResult, ValidationError } from './config.types';

/**
 * Validate an unknown value against the rule configuration schema.
 */
export function validateRuleConfigSchema(rule: unknown): ConfigurationValidationResult {
  const schemaErrors = validateAgainstSchema(rule, ruleConfigSchema, 'rule');

  const errors: ValidationError[] = schemaErrors.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code,
  }));

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

/**
 * Convenience assertion for callers that want to fail fast.
 */
export function assertValidRuleConfig(rule: unknown): void {
  const result = validateRuleConfigSchema(rule);
  if (!result.valid) {
    const summary = result.errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Rule configuration failed schema validation:\n${summary}`);
  }
}
