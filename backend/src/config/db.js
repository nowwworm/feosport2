const { Pool } = require('pg');

if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD must be set in production');
}

function getPoolConfig(env = process.env) {
  return {
    host:     env.DB_HOST     || 'localhost',
    port:     parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME     || 'feosport2',
    user:     env.DB_USER     || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
  };
}

function describePoolConfig(config = getPoolConfig()) {
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
