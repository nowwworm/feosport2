// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const BACKEND_URL  = process.env.BACKEND_URL  || 'http://localhost:8090';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: FRONTEND_URL,
    headless: true,
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  },

  // Tests assume backend (8090) and frontend (8080) are already running.
  // Run `npm run dev` in backend/ and `npm run dev` in frontend/ before
  // executing `npm run test:e2e`, OR set START_SERVERS=1 to have Playwright
  // boot them itself.
  webServer: process.env.START_SERVERS === '1' ? [
    {
      command: 'cd ../backend && node src/server.js',
      port: 8090,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        DB_NAME:     process.env.DB_NAME     || 'feosport2',
        DB_USER:     process.env.DB_USER     || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        JWT_SECRET:  process.env.JWT_SECRET  || 'e2e_secret',
      },
    },
    {
      command: 'npm run dev',
      port: 8080,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ] : undefined,

  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile\.spec\.cjs$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.cjs$/,
      // iPhone 13 device profile (390x844) but Chromium engine — no extra
      // browser install needed and CSS layout is what we're verifying.
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        userAgent: devices['iPhone 13'].userAgent,
      },
    },
  ],
});

module.exports.BACKEND_URL = BACKEND_URL;
module.exports.FRONTEND_URL = FRONTEND_URL;
