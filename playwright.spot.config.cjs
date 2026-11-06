const { defineConfig } = require('@playwright/test');
const { browserTestOrigin } = require('./tests/helpers/browser-origin.cjs');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['spot-browser.spec.cjs', 'spot-soroban-browser.spec.cjs'],
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: browserTestOrigin(process.env.SPOT_TEST_URL),
    headless: !process.env.FACTORY_DESKTOP_CDP_PORT,
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
