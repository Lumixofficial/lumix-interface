const { test, expect } = require('@playwright/test');
const { FEATURES } = require('../components/app-routes.ts');
const fs = require('node:fs');
const path = require('node:path');
const { setEarnWalletFixture, loadAllEarnPools } = require('./helpers/earn-wallet.cjs');

const rows = page => page.locator('tr[data-pool]');
const panel = page => page.locator('.earn-trade-panel');
const amount = page => panel(page).getByRole('textbox', { name: /Amount in/ });
const submit = page => panel(page).locator('button[type="submit"]');
const chart = page => page.getByRole('group', { name: 'Interactive total deposits chart in USD', exact: true });
const ready = async page => expect(chart(page)).toHaveAttribute('aria-busy', 'false');
const open = async (page, id = 'xlm-usdc') => {
  await page.locator(`tr[data-pool="${id}"] .earn-pool-name`).click();
  await expect(page).toHaveURL(new RegExp(`/earn/${id}$`));
  await ready(page);
};
async function action(page, value) {
  await amount(page).fill(value);
  await submit(page).click();
  await expect(panel(page).locator('.earn-success')).toContainText('complete.');
}
async function layout(page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    chartWidth: document.querySelector('.earn-chart-frame').clientWidth,
    canvasWidth: document.querySelector('.earn-chart-canvas').clientWidth,
    position: getComputedStyle(document.querySelector('.earn-trade-panel')).position,
    footerTop: document.querySelector('footer').getBoundingClientRect().top + scrollY,
    contentBottom: document.querySelector('main').getBoundingClientRect().bottom + scrollY,
    scrollLock: getComputedStyle(document.body).overflow,
  }));
}
const screenshots = path.resolve('.impeccable/review');

test.beforeEach(async ({ page }) => {
  test.skip(FEATURES.earnVaults.comingSoon, 'Earn workspace interactions apply after its release gate is enabled.');
  await page.goto('/earn');
  await setEarnWalletFixture(page, true);
  await loadAllEarnPools(page, expect);
});

test('overview desktop: presentation, independent returns and validated account links', async ({ page }) => {
  const { StrKey } = require('@stellar/stellar-sdk/base');
  const account = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(7));
  await setEarnWalletFixture(page, false);
  await expect(page.locator('.earn-overview')).toHaveCount(0);
  await expect(page.locator('.earn-connect-banner .earn-overview-art')).toHaveCount(1);
  await expect(page.locator('.earn-connect-banner')).not.toContainText('TVL');
  await expect(page.locator('.earn-wallet-content')).toContainText('Connect to view your deposits and fees earned.');
  await setEarnWalletFixture(page, true);
  await expect(page.locator('.earn-overview dt')).toHaveText(['Total TVL', 'Your deposited value', 'Your earned fees']);
  await expect(page.locator('.earn-overview-art, .earn-connect-banner')).toHaveCount(0);
  await setEarnWalletFixture(page, false);
  const tvl = page.getByRole('button', { name: 'Sort by TVL', exact: true });
  await tvl.hover(); await expect(page.locator('.earn-tvl-wrap [role="tooltip"]')).toHaveText('Total value locked');
  await tvl.focus(); await expect(page.locator('.earn-tvl-wrap [role="tooltip"]')).toBeVisible(); await page.keyboard.press('Escape');
  const performance = page.getByRole('button', { name: 'Sort by 30D performance', exact: true });
  await performance.click(); await loadAllEarnPools(page, expect);
  await expect(page.locator('.earn-performance-wrap [role="tooltip"]')).toContainText('distinct from estimated fee APR');
  expect(await rows(page).evaluateAll(items => items.map(row => row.dataset.pool))).toEqual(['btc-usdc','xlm-usdc','btc-usdt0','usdc-usdt0','eth-usdt0','xlm-usdt0']);
  await performance.click(); await loadAllEarnPools(page, expect);
  expect(await rows(page).evaluateAll(items => items.map(row => row.dataset.pool))).toEqual(['xlm-usdt0','eth-usdt0','usdc-usdt0','btc-usdt0','xlm-usdc','btc-usdc']);
  await expect(page.locator('.earn-sort-arrow')).toHaveCount(1);
  await setEarnWalletFixture(page, true, account);
  await expect(page.locator('tr[data-pool="eth-usdt0"] td[data-label="Your deposit"] .earn-data')).toHaveText('$838');
  const money = await page.locator('tr[data-pool] td[data-label="TVL"],tr[data-pool] td[data-label="Your deposit"]').allTextContents();
  expect(money.every(value => !/\d\.\d/.test(value))).toBe(true);
  const alignment = await page.evaluate(() => [...document.querySelectorAll('.earn-pool-table .earn-column-label')].map((label, i) =>
    Math.abs(label.getBoundingClientRect().right - document.querySelector(`tr[data-pool] td:nth-child(${i+3}) .earn-data`).getBoundingClientRect().right)));
  expect(alignment.every(delta => delta < 1)).toBe(true);
  await setEarnWalletFixture(page, false); await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(screenshots, 'earn-overview-desktop.png'), fullPage: true });
  await page.locator('tr[data-pool="usdc-usdt0"] .earn-pool-name').click(); await ready(page);
  await expect(page.locator('.earn-transactions-heading')).not.toContainText('UTC');
  await expect(page.locator('.earn-activity-account[href]')).toHaveCount(0);
  const execution = panel(page).locator('.earn-execution');
  await expect(execution).not.toHaveAttribute('open');
  await expect(panel(page).locator('.earn-preview')).toHaveCount(0);
  await execution.locator('summary').click();
  await expect(execution.getByText('Buy value', { exact: true })).toBeVisible();
  await expect(execution.getByText('Fee', { exact: true })).toBeVisible();
  await expect(execution.getByText('Asset price', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('Position added', { exact: true })).toBeVisible();
  await setEarnWalletFixture(page, true, account); await panel(page).locator('.earn-execution summary').click();
  await action(page, '0.123456');
  await expect(page.getByTestId('available-balance')).toHaveText('3,500.530865 USDT0');
  const link = page.locator('tr[data-activity]').first().getByRole('link');
  await expect(link).toHaveAttribute('href', new RegExp(`/explorer/testnet/account/${account}$`));
  await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('title', account);
  await link.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(link).toBeFocused(); await expect(link).toHaveCSS('outline-style', 'solid');
  await expect(panel(page).locator('.earn-success')).not.toContainText(/demo|sample|mock|simulat/i);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(screenshots, 'earn-overview-detail-desktop.png'), fullPage: true });
  expect(await page.locator('main').innerText()).not.toMatch(/\b(mock|demo|simulated|sample)\b/i);
  expect(await page.evaluate(() => window.__earnWalletSignatures)).toBe(0);
});

test('overview mobile: full-width art, compact sort menu with metric help and expanded transaction details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setEarnWalletFixture(page, false);
  await loadAllEarnPools(page, expect);
  await expect(page.locator('.earn-pool-table thead')).toBeHidden();
  const sort = page.getByRole('button', { name: 'Sort by: TVL', exact: true });
  await sort.click();
  const menu = page.getByRole('listbox', { name: 'Sort by', exact: true });
  await expect(menu).toContainText('Total value locked');
  await menu.getByRole('option', { name: '30D performance', exact: true }).click(); await loadAllEarnPools(page, expect);
  expect(await rows(page).locator('td[data-label="30D performance"]').allTextContents()).toEqual(['+3.68%','+2.45%','+1.92%','+0.81%','−0.64%','−1.12%']);
  await page.getByRole('button', { name: 'Sort order: high to low', exact: true }).click(); await loadAllEarnPools(page, expect);
  expect(await rows(page).locator('td[data-label="30D performance"]').allTextContents()).toEqual(['−1.12%','−0.64%','+0.81%','+1.92%','+2.45%','+3.68%']);
  const geometry = await page.evaluate(() => {
    const overview = document.querySelector('.earn-connect-banner').getBoundingClientRect();
    const art = document.querySelector('.earn-overview-art').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - innerWidth, width: overview.width - art.width, height: overview.height - art.height };
  });
  expect(geometry.overflow).toBe(0); expect(Math.abs(geometry.width)).toBeLessThanOrEqual(2); expect(Math.abs(geometry.height)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape'); await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(screenshots, 'earn-overview-mobile.png'), fullPage: true });
  await page.locator('tr[data-pool="usdc-usdt0"] .earn-pool-name').click(); await ready(page);
  const summary = panel(page).locator('.earn-execution summary');
  expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(summary.locator('svg')).toHaveAttribute('width', '20');
  await summary.click(); await expect(panel(page).getByText('Fee', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await expect(page.getByTestId('pool-position')).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/\b(mock|demo|simulated|sample)\b/i);
  expect((await layout(page)).overflow).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(screenshots, 'earn-overview-detail-mobile.png'), fullPage: true });
});

async function checkRefinedDetail(page) {
  await ready(page);
  const sides = panel(page).getByRole('group', { name: 'Order side', exact: true });
  for (const side of ['Buy', 'Sell']) {
    await sides.getByRole('button', { name: side, exact: true }).click();
    await page.mouse.move(0, 0);
    await expect(sides.getByRole('button', { name: side, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => page.evaluate(() => {
      const actual = document.querySelector('.earn-trade-panel .option-order-side-toggle');
      const reference = document.createElement('div');
      reference.className = 'option-trade-panel';
      reference.style.visibility = 'hidden';
      reference.innerHTML = '<div class="trade-segmented option-order-side-toggle" role="group"><button type="button">Buy</button><button type="button">Sell</button></div>';
      document.body.append(reference);
      const expected = reference.firstElementChild;
      [...actual.children].forEach((button, i) => expected.children[i].setAttribute('aria-pressed', button.getAttribute('aria-pressed')));
      const properties = ['backgroundColor','color','padding','border','borderRadius','minHeight','gap','fontSize','fontWeight','boxShadow'];
      const read = el => Object.fromEntries(properties.map(property => [property, getComputedStyle(el)[property]]));
      const readGroup = el => Object.fromEntries(['backgroundColor','padding','border','borderRadius','gap'].map(property => [property, getComputedStyle(el)[property]]));
      const result = { actual: [readGroup(actual), ...[...actual.children].map(read)], expected: [readGroup(expected), ...[...expected.children].map(read)] };
      reference.remove(); return JSON.stringify(result.actual) === JSON.stringify(result.expected);
    })).toBe(true);
  }
  await sides.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.locator('.earn-action-explanation,.earn-precision,.earn-chart-caption')).toHaveCount(0);
  await expect(panel(page).getByRole('combobox')).toHaveCount(0);
  await panel(page).getByText('Execution details', { exact: true }).click();
  await expect(panel(page)).not.toContainText('Assets are supplied and withdrawn independently.');
  await panel(page).getByText('Execution details', { exact: true }).click();
  await expect(page.locator('.earn-chart-canvas a')).toHaveCount(0);
  await expect(page.locator('.earn-chart-credit a')).toHaveText('© 2025 TradingView');
  await expect(page.locator('.earn-pool-description h3')).toHaveText('Description');
  const heading = await page.locator('.earn-detail-header h1').textContent();
  await expect(page.locator('.earn-pool-description')).toContainText(heading);
  await expect(page.locator('.earn-pool-description')).toContainText('perpetual trading');

  const trigger = panel(page).getByRole('button', { name: /^Asset:/ });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('listbox', { name: 'Asset', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(2);
  expect(await menu.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await expect(menu.locator('[aria-selected="true"]')).toBeFocused();
  await page.keyboard.press('Home'); await expect(menu.getByRole('option').first()).toBeFocused();
  await page.keyboard.press('End'); await expect(menu.getByRole('option').last()).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(menu.getByRole('option').first()).toBeFocused();
  await page.keyboard.press('Enter'); await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText(heading.split(' / ')[0]);
  await trigger.click(); await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await page.locator('.earn-chart-heading h2').click();
  await expect(menu).toHaveCount(0);
  await trigger.click(); await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0); await expect(panel(page).getByRole('button', { name: 'Max', exact: true })).toBeFocused();
  await trigger.click(); await expect(menu.locator('[aria-selected="true"]')).toBeFocused();
  await page.keyboard.press('End'); await expect(menu.getByRole('option').last()).toBeFocused(); await page.keyboard.press('Enter');
  await amount(page).fill('0.1234567');
  await expect(panel(page).getByRole('alert')).toContainText('6 decimal places');
  await expect(submit(page)).toBeDisabled();
  await amount(page).fill('');
  const metrics = await layout(page);
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.canvasWidth).toBe(metrics.chartWidth);
}

test('refinement desktop: shared controls, keyboard selector and numbered whole-row links', async ({ page, context }) => {
  await expect(page.locator('.earn-pool-action')).toHaveCount(0);
  expect(await rows(page).locator('.earn-pool-rank').allTextContents()).toEqual(['1','2','3','4','5','6']);
  await page.getByRole('button', { name: 'Sort by estimated APR' }).click();
  await loadAllEarnPools(page, expect); await page.keyboard.press('Escape');
  expect(await rows(page).locator('.earn-pool-rank').allTextContents()).toEqual(['1','2','3','4','5','6']);
  await expect(rows(page).first()).toHaveAttribute('data-pool', 'xlm-usdt0');
  const align = await page.evaluate(() => [...document.querySelectorAll('.earn-pool-table .earn-column-label')].map((el, i) =>
    Math.abs(el.getBoundingClientRect().right - document.querySelector(`tr[data-pool] td:nth-child(${i+3}) .earn-data`).getBoundingClientRect().right)));
  expect(align.every(delta => delta < 1)).toBe(true);
  const row = page.locator('tr[data-pool="usdc-usdt0"]');
  const link = row.getByRole('link');
  await link.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(row).toHaveCSS('outline-style', 'solid');
  await row.hover();
  await expect(row).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.03)');
  expect(await rows(page).last().locator('td').first().evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('0px');
  await page.screenshot({ path: path.join(screenshots, 'earn-refinements-list-desktop.png'), fullPage: true });
  const cell = await row.locator('td[data-label="Est. APR"]').boundingBox();
  const [tab] = await Promise.all([context.waitForEvent('page'), page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2, { button: 'middle' })]);
  await expect(tab).toHaveURL(/\/earn\/usdc-usdt0$/); await tab.close();
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await expect(page).toHaveURL(/\/earn\/usdc-usdt0$/);
  await checkRefinedDetail(page);
  await panel(page).getByRole('button', { name: /^Asset:/ }).click();
  await page.screenshot({ path: path.join(screenshots, 'earn-refinements-detail-desktop.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await action(page, '1');
  await panel(page).getByRole('button', { name: 'Sell', exact: true }).click();
  await action(page, '1');
  await page.getByRole('link', { name: 'Back to Earn', exact: true }).click();
  await loadAllEarnPools(page, expect); await open(page, 'eth-usdt0');
  await expect(page.locator('.earn-pool-description')).toContainText('Ethereum (ETH) and USDT0');
  expect(await page.evaluate(() => window.__earnWalletSignatures)).toBe(0);
});

test('refinement mobile: reachable controls, selector dismissal and public browsing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadAllEarnPools(page, expect);
  expect(await rows(page).locator('.earn-pool-rank').allTextContents()).toEqual(['1','2','3','4','5','6']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: path.join(screenshots, 'earn-refinements-list-mobile.png'), fullPage: true });
  const cell = await page.locator('tr[data-pool="usdc-usdt0"] td[data-label="TVL"]').boundingBox();
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await expect(page).toHaveURL(/\/earn\/usdc-usdt0$/);
  await checkRefinedDetail(page);
  await panel(page).getByRole('button', { name: /^Asset:/ }).click();
  const menu = await page.getByRole('listbox', { name: 'Asset' }).boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0); expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: path.join(screenshots, 'earn-refinements-detail-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await setEarnWalletFixture(page, false);
  await expect(page.getByTestId('available-balance')).toHaveCount(0);
  await expect(page.getByTestId('pool-position')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await expect(page.locator('.earn-pool-description')).toBeVisible();
  await expect(page.locator('tr[data-activity]')).toHaveCount(8);
  expect((await layout(page)).position).toBe('static');
});

test('list retains progressive loading, sorting, help, colors and a single clean bottom border', async ({ page }) => {
  await expect(rows(page)).toHaveCount(6);
  expect(new Set(await rows(page).evaluateAll(rows => rows.map(row => row.dataset.pool))).size).toBe(6);
  const border = await rows(page).last().locator('td').first().evaluate(el => getComputedStyle(el).borderBottomWidth);
  expect(border).toBe('0px');
  await expect(page.locator('.earn-list-note,.earn-result-count,.earn-sort-select')).toHaveCount(0);
  const sort = page.getByRole('button', { name: 'Sort by estimated APR' });
  await sort.click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.earn-skeleton-row')).toHaveCount(3);
  await expect(page.locator('.earn-apr-wrap [role="tooltip"]')).toBeVisible();
  await loadAllEarnPools(page, expect);
  expect(await rows(page).evaluateAll(rows => rows.map(row => row.dataset.pool))).toEqual(['xlm-usdt0','eth-usdt0','btc-usdt0','xlm-usdc','btc-usdc','usdc-usdt0']);
  await expect(page.locator('.earn-sort-arrow')).toHaveCount(1);
  const colors = await page.evaluate(() => {
    const selected = el => ({ bg: getComputedStyle(el, '::selection').backgroundColor, fg: getComputedStyle(el, '::selection').color });
    return { header: selected(document.querySelector('.header-product-nav a')), earn: selected(document.querySelector('.earn-intro h1')) };
  });
  expect(colors.earn).toEqual(colors.header);
  const align = await page.evaluate(() => [...document.querySelectorAll('.earn-pool-table .earn-column-label')].map((el, i) =>
    Math.abs(el.getBoundingClientRect().right - document.querySelector(`tr[data-pool] td:nth-child(${i+3}) .earn-data`).getBoundingClientRect().right)));
  expect(align.every(delta => delta < 1)).toBe(true);
  await page.keyboard.press('Escape');
  await rows(page).first().hover();
  await expect.poll(() => rows(page).first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(255, 255, 255, 0.03)');
  await page.screenshot({ path: path.join(screenshots, 'earn-detail-list.png'), fullPage: true });
});

test('every pool links to its page, with browser back/forward and the shared app shell', async ({ page }) => {
  const ids = await rows(page).evaluateAll(rows => rows.map(row => row.dataset.pool));
  for (const [index, id] of ids.entries()) {
    await loadAllEarnPools(page, expect);
    const link = page.locator(`tr[data-pool="${id}"] .earn-pool-name`);
    await expect(link).toHaveAttribute('href', `/earn/${id}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/earn/${id}$`));
    await expect(page.locator('.earn-detail-header h1')).toBeVisible();
    await expect(page.locator('.trade-app-header')).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (index === 0) {
      await page.goBack(); await expect(page).toHaveURL(/\/earn$/);
      await page.goForward(); await expect(page).toHaveURL(new RegExp(`/earn/${id}$`));
    }
    await page.getByRole('link', { name: 'Back to Earn', exact: true }).click();
    await expect(page).toHaveURL(/\/earn$/);
  }
});

test('direct links, refresh and unknown pool IDs have a usable route', async ({ page }) => {
  await page.goto('/earn/eth-usdt0');
  await expect(page.getByRole('heading', { name: 'ETH / USDT0', exact: true })).toBeVisible();
  await expect(page.locator('.earn-chart-loading')).toBeVisible();
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'ETH / USDT0', exact: true })).toBeVisible();
  await page.goto('/earn/unknown-pool');
  await expect(page.getByRole('heading', { name: 'Pool not found', exact: true })).toBeVisible();
  await expect(page.locator('.trade-app-header')).toBeVisible();
  await expect(page.locator('footer')).toHaveCount(1);
  await page.getByRole('link', { name: 'Back to Earn', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Earn', exact: true })).toBeVisible();
});

test('disconnected public detail hides personal data and uses the shared connection entry point', async ({ page }) => {
  await setEarnWalletFixture(page, false);
  await open(page);
  await expect(page.getByTestId('pool-position')).toHaveCount(0);
  await expect(page.getByTestId('available-balance')).toHaveCount(0);
  await expect(page.getByTestId('resulting-position')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Max', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pool-total')).toHaveText('$3,000,000.00');
  await expect(page.locator('tr[data-activity]')).toHaveCount(8);
  await panel(page).getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByTestId('pool-position')).toHaveText('$2,000.00');
  await expect(page.getByTestId('available-balance')).toHaveText('5,000 USDC');
  expect(await page.evaluate(() => window.__earnWalletConnections)).toBe(1);
  expect(await page.evaluate(() => window.__earnWalletSignatures)).toBe(0);
});

test('Buy/Sell preserve exact accounting, prevent duplicate submission and survive navigation/refresh', async ({ page }) => {
  await open(page);
  const startingFees = await page.getByTestId('pool-fees').textContent();
  const startingVolume = await page.getByTestId('pool-volume').textContent();
  const initialPercent = await page.locator('.earn-composition-bar span').first().getAttribute('data-percent');
  await amount(page).fill('100.1234567');
  await expect(page.getByTestId('resulting-position')).toHaveText('$2,100.12');
  await panel(page).getByRole('form').evaluate(el => { el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect(submit(page)).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: /^Asset:/ })).toBeDisabled();
  await expect(panel(page).locator('.earn-success')).toContainText('100.1234567 USDC');
  await expect(page.getByTestId('available-balance')).toHaveText('4,899.8765433 USDC');
  await expect(page.getByTestId('pool-position')).toHaveText('$2,100.12');
  await expect(page.getByTestId('pool-total')).toHaveText('$3,000,100.12');
  await expect(page.getByTestId('pool-balance-USDC')).toContainText('1,500,100.1234567 USDC');
  await expect(page.locator('tr[data-activity="earn-demo-1"]')).toHaveCount(1);
  await expect(page.locator('tr[data-activity]').first()).toContainText('Buy');
  expect(await page.locator('.earn-composition-bar span').first().getAttribute('data-percent')).not.toBe(initialPercent);
  await page.getByRole('link', { name: 'Back to Earn', exact: true }).click();
  await expect(page.getByTestId('your-deposits')).toHaveText('$4,937.62');
  await expect(page.getByTestId('earned-fees')).toHaveText('$35.62');
  await loadAllEarnPools(page, expect); await open(page);
  await page.reload(); await setEarnWalletFixture(page, true); await ready(page);
  await expect(page.getByTestId('pool-position')).toHaveText('$2,100.12');
  await panel(page).getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(amount(page)).toHaveValue('');
  await action(page, '100.1234567');
  await expect(page.getByTestId('pool-position')).toHaveText('$2,000.00');
  await expect(page.getByTestId('available-balance')).toHaveText('1,500 USDC');
  await expect(page.getByTestId('pool-total')).toHaveText('$3,000,000.00');
  await expect(page.locator('tr[data-activity]').first()).toContainText('Sell');
  await expect(page.getByTestId('pool-earned-fees')).toHaveText('$18.42');
  await expect(page.getByTestId('pool-fees')).toHaveText(startingFees);
  await expect(page.getByTestId('pool-volume')).toHaveText(startingVolume);
  await expect(page.locator('.earn-composition-bar span').first()).toHaveAttribute('data-percent', initialPercent);
  expect(await page.evaluate(() => window.__earnWalletSignatures)).toBe(0);
});

test('input errors, Max, asset/mode resets and activity loading remain usable on the page', async ({ page }) => {
  await open(page);
  for (const [value, error] of [['0','greater than zero'],['-1','greater than zero'],['abc','digits'],['5001','Not enough'],['0.12345678','7 decimal places']]) {
    await amount(page).fill(value);
    await expect(panel(page).getByRole('alert')).toContainText(error);
    await expect(submit(page)).toBeDisabled();
  }
  await panel(page).getByRole('button', { name: 'Max', exact: true }).click();
  await expect(amount(page)).toHaveValue('5000');
  await expect(submit(page)).toBeEnabled();
  await panel(page).getByRole('button', { name: 'Max', exact: true }).click();
  await panel(page).getByRole('button', { name: /^Asset:/ }).click();
  await page.getByRole('option', { name: 'Stellar Lumens (XLM)', exact: true }).click();
  await expect(amount(page)).toHaveValue('');
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Sell', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Max', exact: true }).click();
  await expect(amount(page)).toHaveValue('2000');
  await panel(page).getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(amount(page)).toHaveValue('');
  await expect(page.locator('tr[data-activity]')).toHaveCount(8);
  await page.getByRole('button', { name: 'Load more transactions' }).click();
  await expect(page.locator('tr[data-activity]')).toHaveCount(16);
  await expect(page.getByRole('button', { name: 'Load more transactions' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Earn', exact: true }).click();
  await loadAllEarnPools(page, expect); await open(page, 'btc-usdt0');
  await expect(amount(page)).toHaveValue('');
  await expect(panel(page).getByRole('combobox', { name: 'Asset' })).toHaveValue('USDT0');
});

test('interactive chart ranges, mouse/keyboard tooltips, resizing, sticky bounds and desktop layout', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const changes = new Set();
  for (const [range, count] of [['1D',25],['1W',169],['1M',721],['All',2161]]) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await expect(chart(page)).toHaveAttribute('data-point-count', String(count));
    changes.add(await page.locator('.earn-chart-change').textContent());
  }
  expect(changes.size).toBe(4);
  await chart(page).focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('tooltip')).toContainText('Jul');
  await page.keyboard.press('End'); await expect(page.getByRole('tooltip')).toContainText('$3,000,000.00');
  await page.keyboard.press('Escape'); await expect(page.locator('.earn-chart-tooltip')).toHaveCount(0);
  const bounds = await chart(page).boundingBox();
  await page.mouse.move(bounds.x + bounds.width - 90, bounds.y + 120);
  await expect(page.locator('.earn-chart-tooltip')).toBeVisible();
  const tip = await page.locator('.earn-chart-tooltip').boundingBox();
  expect(tip.x).toBeGreaterThanOrEqual(bounds.x);
  expect(tip.x + tip.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect.poll(async () => (await layout(page)).overflow).toBe(0);
  const resized = await layout(page);
  expect(resized.chartWidth).toBe(resized.canvasWidth);
  expect(resized.chartWidth).toBeLessThan(bounds.width);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await expect.poll(async () => (await layout(page)).position).toBe('sticky');
  await page.evaluate(() => window.scrollTo(0,300));
  await expect.poll(async () => {
    const sticky = await panel(page).boundingBox();
    const header = await page.locator('.trade-app-header').boundingBox();
    return sticky.y >= header.y + header.height;
  }).toBe(true);
  const metrics = await layout(page); expect(metrics.footerTop).toBeGreaterThanOrEqual(metrics.contentBottom);
  expect(metrics.overflow).toBe(0); expect(metrics.scrollLock).not.toBe('hidden');
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(async () => (await layout(page)).position).toBe('static');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0,0)); await page.mouse.move(0,0);
  await expect(page.locator('.earn-detail-header img').first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'earn-detail-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile chart/touch tooltip, public state, accessible trading order and footer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${test.info().project.use.baseURL}/earn/xlm-usdt0`);
  await setEarnWalletFixture(page, false);
  await ready(page);
  await expect(page.getByTestId('pool-position')).toHaveCount(0);
  await expect(page.locator('tr[data-activity]')).toHaveCount(8);
  const bounds = await chart(page).boundingBox();
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + 120);
  await expect(page.locator('.earn-chart-tooltip')).toBeVisible();
  const tip = await page.locator('.earn-chart-tooltip').boundingBox();
  expect(tip.x + tip.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  await panel(page).getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByTestId('available-balance')).toHaveText('3,500.654321 USDT0');
  await action(page, '10');
  await expect(page.getByTestId('pool-position')).toHaveText('$10.00');
  await expect(page.locator('tr[data-activity]').first()).toContainText('10 USDT0');
  await panel(page).getByRole('button', { name: 'Sell', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Max', exact: true }).click(); await submit(page).click();
  await expect(panel(page).locator('.earn-success')).toContainText('Withdrawal complete');
  await expect(page.getByTestId('pool-position')).toHaveText('$0.00');
  await expect(submit(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'About this demo' })).toHaveCount(0);
  const order = await page.evaluate(() => ['.earn-chart-panel','.earn-trade-panel','.earn-stats-panel','.earn-transactions'].map(selector => document.querySelector(selector).getBoundingClientRect().top + scrollY));
  expect(order.every((top, i) => i === 0 || top > order[i-1])).toBe(true);
  const metrics = await layout(page); expect(metrics.overflow).toBe(0); expect(metrics.position).toBe('static');
  expect(metrics.footerTop).toBeGreaterThanOrEqual(metrics.contentBottom);
  const icons = await page.locator('.earn-page img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)); expect(icons).toBe(true);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({ path: path.join(screenshots, 'earn-detail-mobile.png'), fullPage: true });
  expect(errors).toEqual([]); expect(await page.evaluate(() => window.__earnWalletSignatures)).toBe(0);
  await context.close();
});

test('Earn has no service, contract, swap or signing calls and no modal mechanics', () => {
  const files = fs.readdirSync('components').filter(file => /^earn-.*\.(ts|tsx)$/.test(file));
  for (const file of files) {
    const source = fs.readFileSync(path.join('components',file),'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\b(?:sendTransaction|signTransaction|swapAssets|invokeContract|refreshBalances)\s*\(/);
    expect(source).not.toMatch(/createPortal|useAccessibleOverlay|aria-modal|role="dialog"/);
  }
  expect(fs.readFileSync('app/earn/earn.css','utf8')).not.toMatch(/::selection|earn-overlay|earn-dialog/);
});
