const { Pool } = require('pg');

if (process.env.NODE_ENV === 'production' &&
    !process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
  throw new Error('DATABASE_URL or DB_PASSWORD must be set in production');
}

function getPoolConfig(env = process.env) {
  // Railway, Heroku и т.п. отдают единую строку подключения.
  if (env.DATABASE_URL) {
    return { connectionString: env.DATABASE_URL };
  }
  return {
    host:     env.DB_HOST     || 'localhost',
    port:     parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME     || 'feosport2',
    user:     env.DB_USER     || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
  };
}

function describePoolConfig(config = getPoolConfig()) {
  if (config.connectionString) {
    // Не печатаем пароль — только хост/порт/база.
    try {
      const u = new URL(config.connectionString);
      return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch (_) {
      return '<DATABASE_URL>';
    }
  }
  return `${config.user}@${config.host}:${config.port}/${config.database}`;
}

const pool = new Pool(getPoolConfig());

pool.on('error', (err) => {
  console.error('[db] unexpected client error', err);
  process.exit(-1);
});

module.exports = pool;
module.exports.getPoolConfig = getPoolConfig;
module.exports.describePoolConfig = describePoolConfig;
