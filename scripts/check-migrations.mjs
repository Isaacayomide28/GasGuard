#!/usr/bin/env node
/**
 * Issue #995 – Migration safety checks for CI.
 *
 * Scans TypeORM (and similar) migration sources for destructive patterns.
 * Fails the build unless ALLOW_DESTRUCTIVE_MIGRATIONS=true is set explicitly
 * (e.g. after human review / change-management approval).
 *
 * Usage:
 *   node scripts/check-migrations.mjs [path...]
 *   ALLOW_DESTRUCTIVE_MIGRATIONS=true node scripts/check-migrations.mjs
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_GLOBS = [
  "apps/api-service/src/database/migrations",
  "apps/api/src/database/migrations",
  "**/migrations",
];

/** Patterns that drop or irreversibly alter data / structure. */
export const DESTRUCTIVE_PATTERNS = [
  { id: "DROP_TABLE", re: /\bDROP\s+TABLE\b/i, severity: "critical" },
  { id: "DROP_COLUMN", re: /\bDROP\s+COLUMN\b/i, severity: "critical" },
  { id: "DROP_SCHEMA", re: /\bDROP\s+SCHEMA\b/i, severity: "critical" },
  { id: "TRUNCATE", re: /\bTRUNCATE\b/i, severity: "critical" },
  { id: "DELETE_WITHOUT_WHERE", re: /\bDELETE\s+FROM\s+\w+\s*;/i, severity: "high" },
  { id: "ALTER_DROP", re: /\bALTER\s+TABLE\b[\s\S]{0,80}\bDROP\b/i, severity: "critical" },
  { id: "TYPEORM_DROP_TABLE", re: /\.dropTable\s*\(/i, severity: "critical" },
  { id: "TYPEORM_DROP_COLUMN", re: /\.dropColumn\s*\(/i, severity: "critical" },
  { id: "TYPEORM_CLEAR_TABLE", re: /\.clearTable\s*\(/i, severity: "high" },
];

/** Soft warnings – review recommended but not blocking alone. */
export const WARNING_PATTERNS = [
  { id: "RENAME_COLUMN", re: /\bRENAME\s+COLUMN\b|\.renameColumn\s*\(/i },
  { id: "ALTER_TYPE", re: /\bALTER\s+COLUMN\b[\s\S]{0,40}\bTYPE\b/i },
  { id: "CASCADE", re: /\bCASCADE\b/i },
];

/**
 * @param {string} content
 * @param {string} filePath
 */
export function analyzeMigrationSource(content, filePath = "unknown") {
  const findings = [];
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.re.test(content)) {
      findings.push({
        file: filePath,
        id: p.id,
        severity: p.severity,
        kind: "destructive",
      });
    }
  }
  for (const p of WARNING_PATTERNS) {
    if (p.re.test(content)) {
      findings.push({
        file: filePath,
        id: p.id,
        severity: "warning",
        kind: "warning",
      });
    }
  }
  return findings;
}

function collectMigrationFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/\.(ts|js|sql)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
          files.push(full);
        }
      }
    };
    walk(abs);
  }
  return files;
}

export function runMigrationSafetyCheck(options = {}) {
  const allowDestructive =
    options.allowDestructive === true ||
    process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === "true";
  const dirs =
    options.dirs?.length > 0
      ? options.dirs
      : DEFAULT_GLOBS.filter((g) => !g.includes("*")).map((g) =>
          path.join(ROOT, g),
        );

  // Also try common relative paths from monorepo root
  const searchDirs = [
    ...dirs,
    path.join(ROOT, "apps/api-service/src/database/migrations"),
  ];
  const uniqueDirs = [...new Set(searchDirs)];
  const files = collectMigrationFiles(uniqueDirs);

  const allFindings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    allFindings.push(
      ...analyzeMigrationSource(content, path.relative(ROOT, file)),
    );
  }

  const destructive = allFindings.filter((f) => f.kind === "destructive");
  const warnings = allFindings.filter((f) => f.kind === "warning");

  return {
    filesScanned: files.length,
    findings: allFindings,
    destructive,
    warnings,
    allowDestructive,
    passed: destructive.length === 0 || allowDestructive,
  };
}

function main() {
  const extraDirs = process.argv.slice(2);
  const result = runMigrationSafetyCheck({
    dirs: extraDirs.length ? extraDirs : undefined,
  });

  console.log(`Migration safety check — scanned ${result.filesScanned} file(s)`);

  if (result.warnings.length) {
    console.log(`\nWarnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      console.log(`  [warn] ${w.id} in ${w.file}`);
    }
  }

  if (result.destructive.length) {
    console.log(`\nDestructive findings (${result.destructive.length}):`);
    for (const d of result.destructive) {
      console.log(`  [${d.severity}] ${d.id} in ${d.file}`);
    }
    if (!result.allowDestructive) {
      console.error(
        "\nFAIL: Destructive migrations detected. Re-run with ALLOW_DESTRUCTIVE_MIGRATIONS=true after explicit approval.",
      );
      console.error(
        "See docs/MIGRATION_SAFETY.md for rollback limits and approval process.",
      );
      process.exit(1);
    }
    console.warn(
      "\nPASS (override): ALLOW_DESTRUCTIVE_MIGRATIONS=true — destructive changes explicitly approved.",
    );
  } else {
    console.log("\nPASS: No destructive migration patterns detected.");
  }

  process.exit(0);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  main();
}
