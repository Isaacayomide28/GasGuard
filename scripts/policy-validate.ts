#!/usr/bin/env ts-node
/**
 * Validate a GasGuard policy document (issue #1064).
 *
 * Usage:
 *   ts-node scripts/policy-validate.ts <file.json> [--format text|json] [--strict]
 *   npm run policy:validate -- <file.json> --strict
 */
import { main } from "../src/policy/bin";

main();
