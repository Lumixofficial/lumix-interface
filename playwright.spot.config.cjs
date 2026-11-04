const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: ['spot-browser.spec.cjs', 'spot-soroban-browser.spec.cjs'], fullyParallel: false, workers: 1,
  timeout: 40000, expect: { timeout: 10000 }, reporter: 'list',
  use: { baseURL: process.env.SPOT_TEST_BASE_URL || 'http://localhost:3000', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, viewport: { width: 1440, height: 1000 }, headless: true, reducedMotion: 'reduce', screenshot: 'only-on-failure',
    launchOptions: process.env.SPOT_TEST_DEVTOOLS === '1' ? { args: ['--auto-open-devtools-for-tabs'] } : undefined },
});
