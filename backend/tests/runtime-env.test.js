const fs = require('fs');
const os = require('os');
const path = require('path');

const { getPoolConfig } = require('../src/config/db');
const { getRuntimeSummary, loadBundledEnv } = require('../src/config/runtimeEnv');

describe('runtime env loading', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('loadBundledEnv reads .env next to the packaged executable directory', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feosport2-env-'));
    fs.writeFileSync(
      path.join(appDir, '.env'),
      [
        'PORT=8090',
        'DB_HOST=localhost',
        'DB_PORT=5432',
        'DB_NAME=feosport2',
        'DB_USER=feosport',
        'DB_PASSWORD=secret',
      ].join('\n')
    );

    const envInfo = loadBundledEnv(appDir);
    const summary = getRuntimeSummary(appDir, envInfo);

    expect(envInfo.exists).toBe(true);
    expect(summary.dbUser).toBe('feosport');
    expect(getPoolConfig().user).toBe('feosport');
    expect(getPoolConfig().password).toBe('secret');
  });

  test('pool config falls back to postgres only when DB_USER is absent', () => {
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;

    const config = getPoolConfig();

    expect(config.user).toBe('postgres');
    expect(config.password).toBe('postgres');
  });

  test('runtime summary parses DATABASE_URL instead of localhost defaults', () => {
    // Railway/Heroku/Render отдают единую строку — раньше getRuntimeSummary
    // её игнорировал и логировал misleading "postgres@localhost:5432" даже
    // когда реальный коннект шёл на другой хост.
    process.env.DATABASE_URL =
      'postgresql://railwayuser:secret@postgres.railway.internal:6543/railway';
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_NAME;

    const summary = getRuntimeSummary('/app', { envPath: '/app/.env', exists: false });

    expect(summary.dbHost).toBe('postgres.railway.internal');
    expect(summary.dbPort).toBe('6543');
    expect(summary.dbUser).toBe('railwayuser');
    expect(summary.dbName).toBe('railway');
  });
});
