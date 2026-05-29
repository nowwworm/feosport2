const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadBundledEnv(appDir) {
  const envPath = path.join(appDir, '.env');
  const exists = fs.existsSync(envPath);
  if (exists) {
    // `.env` рядом с инсталлятором — каноничный источник конфигурации,
    // переопределяет любые pre-existing env var (унаследованные от системы).
    dotenv.config({ path: envPath, override: true });
  }
  return { envPath, exists };
}

function loadLocalEnv(projectRoot = path.resolve(__dirname, '../../..')) {
  const rootEnvPath = path.join(projectRoot, '.env');
  const backendEnvPath = path.join(projectRoot, 'backend', '.env');
  const loaded = [];

  if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
    loaded.push(rootEnvPath);
  }

  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath, override: true });
    loaded.push(backendEnvPath);
  }

  return {
    envPath: loaded.join(', '),
    exists: loaded.length > 0,
  };
}

// При наличии DATABASE_URL (Railway/Heroku/Render и т.п.) — берём подключение
// оттуда, чтобы лог не врал про localhost:5432 когда коннект идёт куда-то ещё.
function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      dbHost: u.hostname || 'localhost',
      dbPort: u.port || '5432',
      dbUser: decodeURIComponent(u.username || '') || 'postgres',
      dbName: u.pathname ? u.pathname.replace(/^\//, '') : 'feosport2',
    };
  } catch (_) {
    return null;
  }
}

function getRuntimeSummary(appDir, envInfo = {}) {
  const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  return {
    appDir,
    envPath: envInfo.envPath || path.join(appDir, '.env'),
    envExists: Boolean(envInfo.exists),
    port: process.env.PORT || '8090',
    dbHost: fromUrl?.dbHost || process.env.DB_HOST || 'localhost',
    dbPort: fromUrl?.dbPort || process.env.DB_PORT || '5432',
    dbName: fromUrl?.dbName || process.env.DB_NAME || 'feosport2',
    dbUser: fromUrl?.dbUser || process.env.DB_USER || 'postgres',
  };
}

function logRuntimeSummary(summary) {
  console.log('[runtime] appDir:', summary.appDir);
  console.log('[runtime] envPath:', summary.envPath);
  console.log('[runtime] envExists:', summary.envExists ? 'yes' : 'no');
  console.log(
    `[runtime] db: ${summary.dbUser}@${summary.dbHost}:${summary.dbPort}/${summary.dbName}`
  );
  console.log('[runtime] port:', summary.port);
}

module.exports = {
  loadBundledEnv,
  loadLocalEnv,
  getRuntimeSummary,
  logRuntimeSummary,
};
