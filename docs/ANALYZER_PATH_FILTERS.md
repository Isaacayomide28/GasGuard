# Analyzer path filters

Analyzers use `includePaths` as an allow-list and `excludePaths` as an ordered
ignore list. Patterns accept `/` or Windows path separators, `*` for characters
within one path segment, `**` across directories, and `?` for one character.

Ignore rules are evaluated from first to last. The last matching rule wins; a
rule prefixed with `!` re-includes a path ignored by an earlier rule:

```ts
{
  includePaths: ["src/**"],
  excludePaths: ["src/generated/**", "!src/generated/checked.rs"]
}
```

Here all files outside `src` are rejected, generated files are ignored, and
`src/generated/checked.rs` is scanned. A negated exclusion cannot re-include a
path that was not admitted by `includePaths`.
