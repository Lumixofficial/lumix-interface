const { test, expect } = require('@playwright/test');
const { FEATURES } = require('../components/app-routes.ts');

for (const feature of Object.values(FEATURES)) {
  if (!feature.comingSoon) continue;
  test(`${feature.label} stays behind its configured release gate`, async ({ page }) => {
    await page.route('https://api.blux.cc/**', route => route.fulfill({ json: {
      status: 200, message: 'Fixture', result: { privacy_policy: '', terms: '', socials: [] },
    } }));
    await page.goto(feature.route);
    await expect(page.getByRole('heading', { name: /coming\s*soon/i })).toBeVisible();
    await expect(page.locator('.app-status-content')).toBeVisible();
  });
}
