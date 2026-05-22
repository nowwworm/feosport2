'use strict';

// Minimal SQL migration runner.
//
// Layout:
//   database/init.sql                 — v1.0 baseline (applied once on fresh PG via Docker / installer)
//   database/migrations/NNN_name.sql  — incremental migrations on top of the baseline
//
// Tracking: table public.schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ).
//
// Runs each unapplied migration inside its own transaction, in filename order.
// Idempotent: safe to invoke on every app boot.
//
// CLI:    node backend/scripts/migrate.js
// Module: const { runMigrations } = require('./migrate'); await runMigrations(pool);

const fs   = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'database', 'migrations');

function resolveMigrationsDir(override) {
  if (override) return override;
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  // pkg-bundled .exe: look next to the executable in database/migrations/.
  // Installer copies the project tree's database/migrations/ there.
  if (process.pkg) {
    return path.join(path.dirname(process.execPath), 'database', 'migrations');
  }
  return DEFAULT_MIGRATIONS_DIR;
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map(r => r.filename));
}

function listMigrationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(pool, dir, filename) {
  const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${filename} failed: ${err.message}`);
  } finally {
    client.release();
  }
}

async function runMigrations(pool, { log = () => {}, migrationsDir } = {}) {
  const dir = resolveMigrationsDir(migrationsDir);

  const client = await pool.connect();
  let applied;
  try {
    await ensureTrackingTable(client);
    applied = await listAppliedMigrations(client);
  } finally {
    client.release();
  }

  const files = listMigrationFiles(dir);
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    log(`[migrate] up to date (${files.length} known, 0 pending, dir=${dir})`);
    return { applied: [], total: files.length, dir };
  }

  log(`[migrate] dir=${dir}, applying ${pending.length} migration(s): ${pending.join(', ')}`);
  for (const filename of pending) {
    log(`[migrate] -> ${filename}`);
    await applyMigration(pool, dir, filename);
  }
  log(`[migrate] done`);

  return { applied: pending, total: files.length, dir };
}

module.exports = { runMigrations };

if (require.main === module) {
  const pool = require('../src/config/db');
  runMigrations(pool, { log: (m) => console.log(m) })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      pool.end().finally(() => process.exit(1));
    });
}
