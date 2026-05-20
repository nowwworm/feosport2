#!/usr/bin/env node
/**
 * FeoSport2 dev driver
 * Usage: node .claude/skills/run-feosport2/driver.mjs [command]
 *
 * Commands:
 *   start       — launch backend, wait for /healthz
 *   stop        — kill backend on PORT
 *   token       — login as admin, print JWT
 *   smoke       — full smoke test (start, CRUD, stop)
 *   seed-user   — insert admin@feosport.local/admin123 into DB
 */

import { spawn, execSync, spawnSync } from 'child_process';
import { createServer }               from 'net';
import path                           from 'path';
import { fileURLToPath }              from 'url';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../../..');   // feosport2/
const BACKEND   = path.join(ROOT, 'backend');
const PORT      = process.env.PORT || 8090;
const BASE      = `http://localhost:${PORT}`;

// ── DB defaults for local dev (no postgres role on macOS Homebrew) ────────────
const DB_ENV = {
  DB_HOST:     'localhost',
  DB_PORT:     '5432',
  DB_NAME:     'feosport2',
  DB_USER:     process.env.DB_USER     || process.env.USER,
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  JWT_SECRET:  process.env.JWT_SECRET  || 'dev-secret-feosport2',
  PORT:        String(PORT),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetch_(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.text();
  try { return { status: res.status, body: JSON.parse(body) }; }
  catch { return { status: res.status, body }; }
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch_(url);
      if (r.status === 200) return true;
    } catch { /* not yet */ }
    await wait(300);
  }
  throw new Error(`Server not ready at ${url} after ${timeoutMs}ms`);
}

const PID_FILE = path.join(__dirname, '.server.pid');

function stopServer() {
  // Try pid-file first (most reliable)
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    try { spawnSync('kill', ['-TERM', String(pid)]); console.log(`Stopped pid ${pid}`); }
    catch { /* already dead */ }
    try { require('fs').unlinkSync(PID_FILE); } catch { /* ignore */ }
    return;
  }
  // Fallback: lsof
  try {
    const out = execSync(`lsof -ti:${PORT} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (out) { spawnSync('kill', ['-TERM', ...out.split('\n').filter(Boolean)]); }
  } catch { /* nothing running */ }
}

// ── Commands ──────────────────────────────────────────────────────────────────
async function cmdStart() {
  stopServer();
  const proc = spawn('node', ['src/server.js'], {
    cwd: BACKEND,
    env: { ...process.env, ...DB_ENV },
    stdio: 'inherit',
    detached: true,
  });
  proc.unref();
  writeFileSync(PID_FILE, String(proc.pid));
  console.log(`Starting backend (pid ${proc.pid}) on :${PORT}…`);
  await waitReady(`${BASE}/healthz`);
  console.log(`Ready → ${BASE}/healthz`);
}

async function cmdStop() { stopServer(); }

async function cmdToken() {
  const r = await fetch_(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@feosport.local', password: 'admin123' }),
  });
  if (!r.body.token) { console.error('Login failed:', r.body); process.exit(1); }
  console.log(r.body.token);
}

async function cmdSeedUser() {
  const bcrypt = (await import(path.join(BACKEND, 'node_modules/bcryptjs/dist/bcrypt.js'))).default;
  const hash   = await bcrypt.hash('admin123', 10);
  const sql    = `
    INSERT INTO users (email, password_hash, role_id)
    VALUES ('admin@feosport.local', '${hash}', 1)
    ON CONFLICT (email) DO NOTHING;
  `;
  execSync(
    `psql -h localhost -d feosport2 -c "${sql.replace(/\n/g,' ')}"`,
    { stdio: 'inherit' }
  );
  console.log('admin@feosport.local created (password: admin123)');
}

async function cmdSmoke() {
  console.log('── start ──────────────────────────────────');
  await cmdStart();

  console.log('── /healthz ───────────────────────────────');
  const h = await fetch_(`${BASE}/healthz`);
  console.assert(h.body.status === 'ok', 'healthz failed', h);
  console.log('healthz:', h.body);

  console.log('── login ──────────────────────────────────');
  const login = await fetch_(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@feosport.local', password: 'admin123' }),
  });
  if (!login.body.token) {
    console.error('Login failed (no token). Run seed-user first:', login.body);
    process.exit(1);
  }
  const token = login.body.token;
  const auth  = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  console.log('token:', token.slice(0, 30) + '…');

  console.log('── GET /api/pilots ────────────────────────');
  const pilots = await fetch_(`${BASE}/api/pilots`, { headers: auth });
  console.assert(Array.isArray(pilots.body), 'pilots not array', pilots);
  console.log(`pilots count: ${pilots.body.length}`);

  console.log('── POST /api/pilots ───────────────────────');
  const newPilot = await fetch_(`${BASE}/api/pilots`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ first_name: 'Smoke', last_name: 'Test', team: 'CI' }),
  });
  console.assert(newPilot.body.id, 'create pilot failed', newPilot);
  console.log('created pilot id:', newPilot.body.id);

  console.log('── POST /api/competitions ─────────────────');
  const newComp = await fetch_(`${BASE}/api/competitions`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'Smoke Cup 2026', date: '2026-06-01', location: 'Test', status: 'draft' }),
  });
  console.assert(newComp.body.id, 'create competition failed', newComp);
  console.log('created competition id:', newComp.body.id);

  console.log('── stop ───────────────────────────────────');
  await cmdStop();
  console.log('\n✅  Smoke test PASSED');
}

// ── Entry point ───────────────────────────────────────────────────────────────
const cmd = process.argv[2] || 'smoke';
const cmds = { start: cmdStart, stop: cmdStop, token: cmdToken, smoke: cmdSmoke, 'seed-user': cmdSeedUser };
if (!cmds[cmd]) { console.error(`Unknown command: ${cmd}\nAvailable: ${Object.keys(cmds).join(', ')}`); process.exit(1); }
cmds[cmd]().catch(e => { console.error(e.message); process.exit(1); });
