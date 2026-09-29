# Analyzer timeouts, rule lifecycle, and the compatibility matrix

Covers three related pieces of analyzer infrastructure:

- **Analyzer timeout diagnostics** (#1019)
- **Rule deprecation lifecycle** (#1024)
- **Analyzer compatibility matrix** (#1025)

All three live in `libs/engine/core` and are exported from `@engine/core`.

---

## Analyzer timeout diagnostics

### The problem

A single analyzer that never settles takes the whole run with it. The caller
gets no findings at all — not even from the analyzers that finished — and
nothing in the result says which analyzer hung, or on what.

### Configuration

`timeoutMs` on the analyzer config sets a per-analyzer budget:

```ts
const outcome = await runAnalyzers(analyzers, files, { timeoutMs: 30_000 });
```

| Value | Meaning |
|---|---|
| omitted | Default budget, `DEFAULT_ANALYZER_TIMEOUT_MS` (30s) |
| positive number | That budget, in milliseconds |
| `0`, negative, `NaN`, `Infinity` | **No limit** |

Zero means "no limit" rather than "budget of nothing" on purpose. The opposite
reading would make every analyzer fail instantly the moment somebody tried to
turn the limit off.

### Behaviour

`runAnalyzerSafely` never throws. A timeout or a crash degrades to an empty
result plus a structured diagnostic:

```ts
{
  kind: "timeout",
  analyzer: "solidity-analyzer",
  analyzerVersion: "2.1.0",
  elapsedMs: 30004,
  timeoutMs: 30000,
  files: ["contracts/A.sol", "contracts/B.sol"],
  message: 'Analyzer "solidity-analyzer" exceeded its 30000ms budget while analyzing 2 file(s).'
}
```

Diagnostics are also folded into the existing `AnalysisResult.errors` channel,
so any caller that already surfaces analyzer errors picks timeouts up with no
change.

`runAnalyzers` isolates each analyzer: one hanging analyzer costs you that
analyzer's findings and nothing else.

### Known limitation

The underlying promise is **not cancelled** — JavaScript provides no way to
abort an arbitrary promise. The timer is cleared on settle so the process is
not held open, and a late result is discarded. A runaway analyzer may
therefore keep consuming CPU after it has been reported as timed out. Bounding
that properly needs worker isolation, which is a larger change.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every analyzer times out immediately | `timeoutMs` set to a very small positive value |
| Timeouts never fire | `timeoutMs` set to `0` or a negative number, which disables the limit |
| Diagnostic lists `… and N more` files | File list truncated at 10 entries to keep diagnostics bounded |

---

## Rule deprecation lifecycle

### The problem

Rules cannot simply be deleted. Configs in the wild reference them by id, and
a rule that vanishes turns a pinned config into a silent no-op.

### Stages

```
active  ──►  deprecated  ──►  removed
```

| Stage | Metadata | Does it run? |
|---|---|---|
| `active` | no `deprecation` field | yes |
| `deprecated` | `deprecation.since` set | **yes** |
| `removed` | `deprecation.removedIn` set | no |

A deprecated rule **keeps running**. That is the entire point of a deprecation
period — stopping it at deprecation would defeat the purpose.

### Declaring a deprecation

```ts
{
  id: "g002",
  // …
  deprecation: {
    since: "2.0.0",
    reason: "Superseded by a more precise check.",
    replacedBy: "g010",
    removeIn: "3.0.0",
  },
}
```

Once the rule stops running, set `removedIn`.

### Warnings

`collectLifecycleWarnings(rules, config)` returns warnings only for rules the
config **explicitly names**. Warning about every deprecated rule in the
catalogue would bury the ones a user can act on.

| Config | Rule stage | Warned? |
|---|---|---|
| not mentioned | deprecated | no |
| `true` or `false` | deprecated | yes |
| `true` | removed | yes |
| `false` | removed | no — disabling something already gone is harmless |

`selectExecutableRules` drops removed rules regardless of config: re-enabling
something that no longer exists must not resurrect it.

`resolveReplacement` follows `replacedBy` chains and is cycle-guarded, so a bad
metadata edit surfaces as an unresolved id rather than a hang.

---

## Analyzer compatibility matrix

### The problem

Which analyzer covers which language is only discoverable by calling every
analyzer and comparing by hand. That hides two real problems:

1. **A language nothing analyzes.** Files produce zero findings, which is
   indistinguishable from being clean.
2. **Two analyzers claiming the same language** without anyone deciding that
   was intended.

### Usage

```ts
const matrix = buildCompatibilityMatrix(
  registry.getAllAnalyzers(),
  [Language.SOLIDITY, Language.RUST, Language.SOROBAN], // languages you claim to support
);

if (!isMatrixHealthy(matrix)) {
  console.error(matrix.issues);
}

writeFileSync("docs/COMPATIBILITY_MATRIX.md", renderMatrixMarkdown(matrix));
```

`expectedLanguages` is what makes gaps visible. Without it, a language nobody
analyzes simply never appears in the matrix.

### Issue kinds

| Kind | Meaning | Fails `isMatrixHealthy` |
|---|---|---|
| `uncovered-language` | An expected language has no analyzer | yes |
| `no-languages` | An analyzer declares none, so is never selected | yes |
| `missing-dependency` | `getDependencies()` names an unregistered analyzer | yes |
| `overlapping-coverage` | Several analyzers claim one language | no — flagged for review only |

Overlap is tolerated because it is sometimes deliberate; it is reported so it
is a decision rather than an accident.

`renderMatrixMarkdown` is deterministic — analyzers and languages are sorted
and the timestamp is excluded — so a generated doc committed to the repo does
not churn on every run.
