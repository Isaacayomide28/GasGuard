#!/usr/bin/env node
// Inventories third-party npm/pnpm dependency licenses across the workspace and
// writes THIRD_PARTY_NOTICES.md at the repo root, plus a Rust crate list sourced
// from Cargo.lock (Cargo.lock has no license field; see
// scripts/generate-rust-license-notices.sh for resolved Rust license text).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WORKSPACE_MANIFESTS = [
  'package.json',
  'apps/api-service/package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'libs/cache/package.json',
  'libs/engine/package.json',
  'libs/gas-evaluator/package.json',
  'libs/testing/package.json',
  'packages/cli/package.json',
  'packages/stellar-sdk/package.json',
  'packages/tsconfig/package.json',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectDirectDependencies() {
  const deps = new Map(); // name -> Set(versionRanges)
  for (const rel of WORKSPACE_MANIFESTS) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const pkg = readJson(abs);
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(pkg[field] || {})) {
        if (!deps.has(name)) deps.set(name, new Set());
        deps.get(name).add(range);
      }
    }
  }
  return deps;
}

function licenseOf(pkgJson) {
  if (typeof pkgJson.license === 'string') return pkgJson.license;
  if (pkgJson.license && pkgJson.license.type) return pkgJson.license.type;
  if (Array.isArray(pkgJson.licenses)) {
    return pkgJson.licenses.map((l) => l.type || l).join(' OR ');
  }
  return 'UNKNOWN';
}

function walkNodeModules(nodeModulesDir) {
  const resolved = new Map(); // "name@version" -> { name, version, license }
  if (!existsSync(nodeModulesDir)) return resolved;

  const entries = readdirSync(nodeModulesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;

    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        addPackage(join(scopeDir, scoped.name), resolved);
      }
      continue;
    }
    addPackage(join(nodeModulesDir, entry.name), resolved);
  }
  return resolved;
}

function addPackage(pkgDir, resolved) {
  const manifest = join(pkgDir, 'package.json');
  if (!existsSync(manifest)) return;
  try {
    const pkg = readJson(manifest);
    if (!pkg.name || !pkg.version) return;
    resolved.set(`${pkg.name}@${pkg.version}`, {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
    });
  } catch {
    // Skip unreadable/malformed package.json files.
  }
}

function collectRustCrates() {
  const lockPath = join(ROOT, 'Cargo.lock');
  if (!existsSync(lockPath)) return [];
  const text = readFileSync(lockPath, 'utf8');
  const crates = [];
  const blockRe = /\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g;
  let match;
  while ((match = blockRe.exec(text))) {
    crates.push({ name: match[1], version: match[2] });
  }
  return crates;
}

function renderNpmSection(resolvedPackages, directDeps) {
  const lines = [];
  if (resolvedPackages.size > 0) {
    lines.push(
      `_Resolved from \`node_modules\` — ${resolvedPackages.size} package installs across the workspace._`,
      '',
      '| Package | Version | License |',
      '|---|---|---|',
    );
    const rows = [...resolvedPackages.values()].sort((a, b) =>
      a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
    );
    for (const { name, version, license } of rows) {
      lines.push(`| ${name} | ${version} | ${license} |`);
    }
  } else {
    lines.push(
      '_`node_modules` was not present when this file was generated, so only direct,_',
      '_declared dependencies are listed below. Run `pnpm install` and re-run_',
      '_`node scripts/generate-third-party-notices.mjs` to resolve transitive packages_',
      '_and their license identifiers._',
      '',
      '| Package | Declared range | License |',
      '|---|---|---|',
    );
    const rows = [...directDeps.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, ranges] of rows) {
      lines.push(`| ${name} | ${[...ranges].join(', ')} | UNKNOWN (unresolved) |`);
    }
  }
  return lines.join('\n');
}

function renderRustSection(crates) {
  const lines = [
    '_Crate name/version pairs are sourced from `Cargo.lock`, which does not carry_',
    '_license metadata. Run `scripts/generate-rust-license-notices.sh` (wraps_',
    '_`cargo license`) to produce the license text for these crates._',
    '',
    '| Crate | Version |',
    '|---|---|',
  ];
  const rows = [...crates].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
  for (const { name, version } of rows) {
    lines.push(`| ${name} | ${version} |`);
  }
  return lines.join('\n');
}

function main() {
  const directDeps = collectDirectDependencies();
  const resolvedPackages = walkNodeModules(join(ROOT, 'node_modules'));
  const rustCrates = collectRustCrates();

  const generatedAt = new Date().toISOString();
  const doc = `# Third-Party Notices

This file is generated by \`scripts/generate-third-party-notices.mjs\`. Do not edit by
hand — regenerate it instead. See [docs/LICENSING_AND_THIRD_PARTY_NOTICES.md](docs/LICENSING_AND_THIRD_PARTY_NOTICES.md)
for the review process, cadence, and scope.

Generated: ${generatedAt}

## npm / pnpm packages

${renderNpmSection(resolvedPackages, directDeps)}

## Rust crates

${renderRustSection(rustCrates)}

## Submodules

- \`lib/forge-std\` ([foundry-rs/forge-std](https://github.com/foundry-rs/forge-std)) — Apache-2.0 OR MIT.
  Verify against the checked-out submodule's own LICENSE files before each release,
  since upstream licensing can change independently of this repository.
`;

  writeFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), doc);
  console.log(
    `Wrote THIRD_PARTY_NOTICES.md (${resolvedPackages.size} resolved npm packages, ` +
      `${directDeps.size} direct npm deps, ${rustCrates.length} Rust crates).`,
  );
}

main();
