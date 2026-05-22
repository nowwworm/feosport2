/**
 * Entry point for pkg-compiled Windows executable.
 * Serves both the API and the pre-built React frontend from a single process.
 */
const path = require('path');
const {
  getRuntimeSummary,
  loadBundledEnv,
  logRuntimeSummary,
} = require('./config/runtimeEnv');

// When running as pkg exe, process.execPath = path to the .exe
// When running as plain node, fall back to project root
const appDir = process.pkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '../../..');

const envInfo = loadBundledEnv(appDir);
logRuntimeSummary(getRuntimeSummary(appDir, envInfo));

const http    = require('http');
const express = require('express');
const app     = require('./app');
const pool    = require('./config/db');
const { initSocket }   = require('./services/socket');
const { runMigrations } = require('../scripts/migrate');

// Serve pre-built frontend (placed next to the exe by the installer)
const frontendDist = path.join(appDir, 'frontend-dist');
app.use(express.static(frontendDist));

// TMX — статический SPA по пути /tmx/
const tmxDist = path.join(appDir, 'tmx-dist');
app.use('/tmx', express.static(tmxDist));
// SPA fallback для /tmx/* → tmx-dist/index.html
app.use('/tmx/*', (_req, res) => {
  res.sendFile(path.join(tmxDist, 'index.html'));
});

// SPA fallback — all non-API routes → index.html (основной фронтенд)
app.use('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const PORT = parseInt(process.env.PORT || '8090', 10);

const httpServer = http.createServer(app);
initSocket(httpServer);

(async () => {
  try {
    await runMigrations(pool, { log: (m) => console.log(m) });
  } catch (err) {
    console.error('[bundled] migrations failed:', err.message);
    process.exit(1);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`FeoSport2 listening on http://localhost:${PORT}`);
  });
})();
