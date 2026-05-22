'use strict';

// Tests for the SQL migration runner (backend/scripts/migrate.js).
// Verifies tracking-table creation, ordered application, idempotency,
// and per-migration transactional rollback.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const pool = require('../src/config/db');
const { runMigrations } = require('../scripts/migrate');

function makeTmpMigrationsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feosport-mig-'));
}

function writeMigration(dir, filename, sql) {
  fs.writeFileSync(path.join(dir, filename), sql);
}

describe('migrate runner', () => {
  const createdTables = new Set();

  // Helper to track tables we create for cleanup
  function track(table) {
    createdTables.add(table);
    return table;
  }

  afterEach(async () => {
    for (const table of createdTables) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    createdTables.clear();
    // Clear tracking rows we added in this test
    await pool.query(`DELETE FROM schema_migrations WHERE filename LIKE 'test_%'`);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('creates schema_migrations tracking table', async () => {
    const dir = makeTmpMigrationsDir();
    await runMigrations(pool, { migrationsDir: dir });

    const { rows } = await pool.query(
      `SELECT to_regclass('public.schema_migrations') AS name`
    );
    expect(rows[0].name).toBe('schema_migrations');
  });

  test('applies migrations in filename order', async () => {
    const dir = makeTmpMigrationsDir();
    track('test_alpha');
    writeMigration(dir, 'test_001_alpha.sql',
      'CREATE TABLE test_alpha (id SERIAL PRIMARY KEY, label TEXT);');
    writeMigration(dir, 'test_002_alter.sql',
      "ALTER TABLE test_alpha ADD COLUMN extra TEXT DEFAULT 'x';");

    const result = await runMigrations(pool, { migrationsDir: dir });
    expect(result.applied).toEqual(['test_001_alpha.sql', 'test_002_alter.sql']);

    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'test_alpha' ORDER BY ordinal_position`
    );
    expect(rows.map(r => r.column_name)).toEqual(['id', 'label', 'extra']);
  });

  test('skips already-applied migrations', async () => {
    const dir = makeTmpMigrationsDir();
    track('test_idempotent');
    writeMigration(dir, 'test_010_create.sql',
      'CREATE TABLE test_idempotent (id SERIAL PRIMARY KEY);');

    const first  = await runMigrations(pool, { migrationsDir: dir });
    const second = await runMigrations(pool, { migrationsDir: dir });

    expect(first.applied).toEqual(['test_010_create.sql']);
    expect(second.applied).toEqual([]);
  });

  test('rolls back a failing migration', async () => {
    const dir = makeTmpMigrationsDir();
    writeMigration(dir, 'test_020_broken.sql',
      'CREATE TABLE test_broken (id SERIAL PRIMARY KEY); ' +
      'INSERT INTO no_such_table VALUES (1);');

    await expect(runMigrations(pool, { migrationsDir: dir })).rejects.toThrow(/test_020_broken/);

    const { rows } = await pool.query(
      `SELECT to_regclass('public.test_broken') AS name`
    );
    expect(rows[0].name).toBeNull();

    const { rows: tracked } = await pool.query(
      `SELECT filename FROM schema_migrations WHERE filename = 'test_020_broken.sql'`
    );
    expect(tracked).toEqual([]);
  });

  test('applies real Минспорт migrations (001-004)', async () => {
    // Run the project's actual migrations (default dir). Should be idempotent
    // if testDB.seedBaselineData has already invoked them in another suite.
    await runMigrations(pool);

    const { rows: applied } = await pool.query(
      `SELECT filename FROM schema_migrations
        WHERE filename IN (
          '001_reference_tables.sql',
          '002_seed_reference_data.sql',
          '003_equipment_reference.sql',
          '004_seed_equipment_data.sql'
        )
        ORDER BY filename`
    );
    expect(applied.map(r => r.filename)).toEqual([
      '001_reference_tables.sql',
      '002_seed_reference_data.sql',
      '003_equipment_reference.sql',
      '004_seed_equipment_data.sql',
    ]);
  });
});
