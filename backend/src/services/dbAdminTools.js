'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getPoolConfig } = require('../config/db');

const PGADMIN_CANDIDATES = [
  'C:\\Program Files\\pgAdmin 4\\runtime\\pgAdmin4.exe',
  'C:\\Program Files (x86)\\pgAdmin 4\\runtime\\pgAdmin4.exe',
  'C:\\Program Files\\PostgreSQL\\17\\pgAdmin 4\\runtime\\pgAdmin4.exe',
  'C:\\Program Files\\PostgreSQL\\16\\pgAdmin 4\\runtime\\pgAdmin4.exe',
  'C:\\Program Files\\PostgreSQL\\15\\pgAdmin 4\\runtime\\pgAdmin4.exe',
];

function expandEnvPath(candidate, env = process.env) {
  return candidate
    .replace('%ProgramFiles%', env.ProgramFiles || 'C:\\Program Files')
    .replace('%ProgramFiles(x86)%', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
}

function findPgAdmin(env = process.env, existsSync = fs.existsSync) {
  const candidates = [
    ...(env.PGADMIN_PATH ? [env.PGADMIN_PATH] : []),
    ...PGADMIN_CANDIDATES,
  ].map(candidate => expandEnvPath(candidate, env));

  return candidates.find(candidate => existsSync(candidate)) || null;
}

async function getDbAdminStatus(pool, env = process.env) {
  const config = getPoolConfig(env);
  const [{ rows: versionRows }, { rows: userRows }] = await Promise.all([
    pool.query('SELECT version() AS version, current_database() AS database, current_user AS user'),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE email IN ('admin@feosport.local','chief@feosport.local','judge@feosport.local','pilot@feosport.local')`
    ),
  ]);

  const pgAdminPath = findPgAdmin(env);

  return {
    ok: true,
    connection: {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
    },
    server: versionRows[0],
    baselineUsers: userRows[0]?.count || 0,
    pgAdmin: {
      available: Boolean(pgAdminPath),
      path: pgAdminPath,
    },
  };
}

function startPgAdmin(env = process.env) {
  const pgAdminPath = findPgAdmin(env);
  if (!pgAdminPath) {
    return Promise.resolve({
      ok: false,
      error: 'pgAdmin не найден. Установите pgAdmin 4 или задайте PGADMIN_PATH в .env.',
    });
  }

  return new Promise((resolve) => {
    const child = execFile(pgAdminPath, [], {
      cwd: path.dirname(pgAdminPath),
      windowsHide: false,
      detached: true,
      stdio: 'ignore',
    }, (error) => {
      if (error) {
        resolve({ ok: false, error: error.message });
      }
    });

    child.unref();
    resolve({ ok: true, message: 'pgAdmin запускается', path: pgAdminPath });
  });
}

module.exports = {
  findPgAdmin,
  getDbAdminStatus,
  startPgAdmin,
};
