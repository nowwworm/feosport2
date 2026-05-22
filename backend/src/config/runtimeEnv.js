const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadBundledEnv(appDir) {
  const envPath = path.join(appDir, '.env');
  const exists = fs.existsSync(envPath);
  if (exists) {
    dotenv.config({ path: envPath });
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

function getRuntimeSummary(appDir, envInfo = {}) {
  return {
    appDir,
    envPath: envInfo.envPath || path.join(appDir, '.env'),
    envExists: Boolean(envInfo.exists),
    port: process.env.PORT || '8090',
    dbHost: process.env.DB_HOST || 'localhost',
    dbPort: process.env.DB_PORT || '5432',
    dbName: process.env.DB_NAME || 'feosport2',
    dbUser: process.env.DB_USER || 'postgres',
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
