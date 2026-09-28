import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeMigrationSource } from "./check-migrations.mjs";

describe("migration safety analyzer (issue #995)", () => {
  it("flags DROP TABLE as critical", () => {
    const f = analyzeMigrationSource('await queryRunner.query("DROP TABLE users")');
    assert.ok(f.some((x) => x.id === "DROP_TABLE" && x.severity === "critical"));
  });

  it("flags TypeORM dropTable", () => {
    const f = analyzeMigrationSource("await queryRunner.dropTable('audit_logs')");
    assert.ok(f.some((x) => x.id === "TYPEORM_DROP_TABLE"));
  });

  it("passes clean additive migration", () => {
    const f = analyzeMigrationSource(`
      await queryRunner.createTable(new Table({
        name: 'widgets',
        columns: [{ name: 'id', type: 'uuid', isPrimary: true }],
      }));
    `);
    assert.equal(f.filter((x) => x.kind === "destructive").length, 0);
  });

  it("flags DROP COLUMN", () => {
    const f = analyzeMigrationSource("ALTER TABLE t DROP COLUMN obsolete");
    assert.ok(f.some((x) => x.id === "DROP_COLUMN"));
  });
});
