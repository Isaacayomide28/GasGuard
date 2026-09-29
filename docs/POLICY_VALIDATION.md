# Policy validation command

Operators and CI use this command to check a GasGuard policy document before
that document is allowed to gate a build. The command checks shape, bounds,
and fail-closed defaults. It does not scan source code and it does not decide
whether a finding fails a build.

Issue: [#1064](https://github.com/MDTechLabs/GasGuard/issues/1064).

## Dependencies

| Dependency | How this command uses it |
|---|---|
| `src/config/config.interface.ts` (`SeverityThreshold`, `VALID_SEVERITIES`) | Policy severities are the same five levels as `.gasguardrc` `severityThreshold`: `critical`, `high`, `medium`, `low`, `info`. The meanings differ. Project config filters what a scan reports. `gates.minSeverity` is the lowest severity that should fail a build. |
| Node.js 20 `crypto.randomUUID` | Correlation id on every validation run. |
| TypeScript CLI (`packages/cli`) and `scripts/policy-validate.ts` | Two entry points over the same `runPolicyValidateCli` function. |

These issues extend policy behavior and are **not** implemented here. Their
fields are rejected with `UNKNOWN_FIELD` until that change also updates this
validator, so a half-specified document cannot pass:

| Issue | Behavior this command does not perform |
|---|---|
| [#977](https://github.com/MDTechLabs/GasGuard/issues/977) | Evaluate a policy against findings and fail the build |
| [#1061](https://github.com/MDTechLabs/GasGuard/issues/1061) | Severity override rules |
| [#1062](https://github.com/MDTechLabs/GasGuard/issues/1062) | Exceptions with approval |
| [#1063](https://github.com/MDTechLabs/GasGuard/issues/1063) | Organization policy inheritance |
| [#1065](https://github.com/MDTechLabs/GasGuard/issues/1065) | Simulation mode |
| [#1066](https://github.com/MDTechLabs/GasGuard/issues/1066) | Resolving a pinned policy version |
| [#1067](https://github.com/MDTechLabs/GasGuard/issues/1067) | Policy change audit history |
| [#1069](https://github.com/MDTechLabs/GasGuard/issues/1069) | Conflict detection across policies |

The Rust `gasguard` binary does not proxy this command. Run the Node script
or the TypeScript CLI below.

## Usage

```bash
npm run policy:validate -- config/policies/production.policy.json
npm run policy:validate -- config/policies/production.policy.json --strict --format json

# From the TypeScript CLI (packages/cli):
gasguard policy validate config/policies/production.policy.json --strict
```

`--strict` is the setting to use in CI. Warnings such as an omitted `mode`
still leave the document usable locally, and `--strict` turns those warnings
into errors so a merged policy cannot depend on an implicit default.

```yaml
- name: Validate production policy
  run: npm run policy:validate -- config/policies/production.policy.json --strict --format json
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The document is valid for the selected mode |
| 1 | Schema validation failed, or `--strict` promoted a warning |
| 2 | The file could not be read, or the arguments are invalid |

The report goes to stdout. Logs go to stderr as one JSON object per line.
Logs include the correlation id, outcome, error and warning counts, and
duration. They do not include the policy body.

Set `GASGUARD_POLICY_DEBUG=1` to add the underlying error message to the
stderr log when validation fails unexpectedly. Leave it unset in CI.

## Policy document

JSON only. `.yml` and `.yaml` are rejected so a policy cannot use YAML tags
or ambiguous scalars. Files larger than 256 KiB are rejected before parse.

Checked-in example: `config/policies/production.policy.json`.

```json
{
  "schemaVersion": "1",
  "name": "production",
  "version": "1.0.0",
  "description": "Fail the build when a scan reports a high or critical finding.",
  "mode": "enforce",
  "gates": {
    "minSeverity": "high",
    "maxFindings": 0,
    "maxFindingsBySeverity": { "critical": 0, "high": 0 },
    "paths": ["contracts/**", "packages/**"]
  },
  "scope": {
    "include": ["**/*.rs", "**/*.sol"],
    "exclude": ["target/**", "node_modules/**"]
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `schemaVersion` | yes | The string `"1"`. The number `1` is rejected. |
| `name` | yes | 1–64 characters: lowercase letters, digits, hyphens. Must not start or end with a hyphen. |
| `version` | yes | Semantic version without leading zeros (`1.2.3` or `1.2.3-rc.1`). This pins the policy document's own version. It does not fetch another copy. |
| `description` | no | 1–500 characters. Control characters other than tab, newline, and carriage return are rejected. |
| `mode` | no | `enforce` (default), `warn`, or `disabled`. |
| `gates` | yes | Object. See below. |
| `gates.minSeverity` | no | One of the five severities. Default `high`. |
| `gates.ruleIds` | no | Rule ids that always fail the build. Unique. Pattern: a letter, then letters, digits, or `.` `_` `:` `-`. |
| `gates.paths` | no | Relative paths or globs the gate applies to. |
| `gates.maxFindings` | no | Integer from 0 through 1,000,000. |
| `gates.maxFindingsBySeverity` | no | Object whose keys are severities and whose values are the same integer range. |
| `scope.include` / `scope.exclude` | no | Relative paths or globs. |

Any other field is an error. Paths must be relative, use forward slashes, be
at most 256 characters, and must not contain `..`. Lists are capped at 200
entries. Values are not coerced: `"0"` is not a number, and surrounding
whitespace is not trimmed.

### Secure defaults

| Omission | Behavior |
|---|---|
| `mode` | `enforce`, plus warning `MISSING_MODE_DEFAULTED` |
| `gates.minSeverity` | `high`, plus warning `DEFAULT_MIN_SEVERITY` |
| No `maxFindings` and no severity caps | Warning `NO_FINDING_CAP`. The severity gate still applies. |
| `mode: "disabled"` | Valid, plus warning `POLICY_MODE_DISABLED` |
| `minSeverity: "info"` | Valid, plus warning `NOISY_MIN_SEVERITY` |

A document that omits `gates` entirely is invalid. The command does not
invent a gate section.

## Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| Exit 2, `FILE_NOT_FOUND` | The path does not exist | Pass the policy file path, not the directory that contains it |
| Exit 2, `UNSUPPORTED_FORMAT` | The file is not `.json` | Save the policy as JSON. YAML is intentionally rejected |
| Exit 2, `FILE_TOO_LARGE` | The file is over 256 KiB | Split inherited or generated content out of the document. Inheritance is a separate feature |
| Exit 2, `INVALID_JSON` | The file is empty, has a trailing comma, or is not JSON | Validate the file with a JSON parser. A UTF-8 BOM is accepted |
| Exit 1, `UNKNOWN_FIELD` | The document uses a field this schema does not declare | Remove the field. Override, exception, and `extends` keys are not accepted yet |
| Exit 1, `INVALID_SCHEMA_VERSION` | `schemaVersion` is missing or is the number `1` | Set `"schemaVersion": "1"` |
| Exit 1, `INVALID_PATH` | A path is absolute, contains `..`, or uses backslashes | Use a relative forward-slash path such as `contracts/**` |
| Exit 1 under `--strict`, code `MISSING_MODE_DEFAULTED` or `DEFAULT_MIN_SEVERITY` | The document relied on a default | Set `mode` and `gates.minSeverity` explicitly |
| stderr shows `INTERNAL_ERROR` | The validator crashed | Re-run with `GASGUARD_POLICY_DEBUG=1` and keep the policy file out of the ticket if it contains internal notes |

## Verification

```bash
npx jest src/policy --runInBand
npm run policy:validate -- config/policies/production.policy.json --strict --format json
```

Unit tests cover accepted documents, defaults, and rejected names, versions,
severities, caps, paths, and unknown fields. The integration tests load the
checked-in production policy, exercise the command's text and JSON reports,
and run `scripts/policy-validate.ts` as a subprocess.
