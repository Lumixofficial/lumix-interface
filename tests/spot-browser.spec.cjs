const { test, expect } = require('@playwright/test');
const { Keypair } = require('@stellar/stellar-sdk');
const extraIssuer = Keypair.random().publicKey();
const otherIssuer = Keypair.random().publicKey();
const registry = { assets: [{ code: 'EURC', issuer: extraIssuer }] };
const { circleTestnetUsdc, circleTestnetEurc, mainnetOnly } = require('../components/spot-verified-assets.json');
const tokenImages = require('../components/spot-token-images.json');
const horizon = 'https://horizon-testnet.stellar.org';
const paths = `${horizon}/paths/strict-send*`;
const fakePath = (amount, output) => ({ _embedded: { records: [{ source_asset_type: 'native', source_amount: amount,
  destination_asset_type: 'credit_alphanum4', destination_asset_code: 'USDC', destination_asset_issuer: circleTestnetUsdc.issuer, destination_amount: output, path: [] }] } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/spot/quotes', route => route.fulfill({ json: { enabled: false } }));
  await page.route(horizon, route => route.fulfill({ json: { network_passphrase: 'Test SDF Network ; September 2015' } }));
  await page.route(horizon + '/ledgers?*', route => route.fulfill({ json: { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100 }] } } }));
  await page.route(horizon + '/assets?*', route => route.fulfill({ json: { _embedded: { records: [] } } }));
  await page.route(horizon + '/accounts/*', route => route.fulfill({ status: 404, json: { status: 404, detail: 'Account not found' } }));
  await page.route(paths, route => {
    const amount = new URL(route.request().url()).searchParams.get('source_amount');
    return route.fulfill({ json: fakePath(amount, '935.8557516') });
  });
});

test('empty defaults, decimal editing and paste validation never quote an untouched or cleared amount', async ({ page }) => {
  let calls = 0;
  await page.route(paths, route => { calls++; return route.fulfill({ json: fakePath(new URL(route.request().url()).searchParams.get('source_amount'), '2.1234567') }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/spot');
  const input = page.locator('#pay-amount'), output = page.getByLabel('Estimated receive amount');
  await expect(input).toBeEnabled(); await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', '0.00');
  await expect(input).toHaveAttribute('type', 'text'); await expect(input).toHaveAttribute('inputmode', 'decimal');
  await expect(page.getByRole('button', { name: /Choose pay asset: XLM,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp('Choose receive asset: USDC,.*' + circleTestnetUsdc.issuer) })).toBeVisible();
  await expect(output).toHaveText('-'); await expect(output).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.spot-status')).toHaveCount(0); expect(calls).toBe(0);
  await input.press('a'); await expect(input).toHaveValue(''); await expect(page.locator('.spot-status')).toHaveCount(0); expect(calls).toBe(0);
  await input.fill('.'); await expect(output).toHaveText('-');
  await input.fill('0'); await expect(output).toHaveText('-'); expect(calls).toBe(0);
  await input.blur(); await expect(page.locator('.spot-status')).toContainText('greater than zero');
  await input.fill('.5'); await expect(output).toHaveText('2.12');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.locator('.spot-quotes-head')).toHaveText('Swap quote1 quote');
  await expect(page.locator('.spot-quotes')).not.toContainText('Soroban');
  await expect(input).toHaveValue('.5');
  await input.fill('12.345'); await input.evaluate(element => element.setSelectionRange(1, 2)); await input.press('9');
  await expect(input).toHaveValue('19.345');
  for (const value of ['1e2', '-1', '+1', '1,000', 'abc', '1.2.3']) {
    await input.fill(value); await expect(input).toHaveValue('19.345');
    await expect(page.locator('.spot-status')).toHaveCount(0);
    await expect(output).toHaveText('2.12');
  }
  await input.evaluate(element => element.setSelectionRange(2, 2)); await input.press('a');
  await expect(input).toHaveValue('19.345'); expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([2, 2]);
  await input.fill('1.1234567'); await expect(output).toHaveText('2.12');
  const pasteAccepted = await input.evaluate(element => {
    element.setSelectionRange(0, element.value.length);
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '1e3');
    return element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  expect(pasteAccepted).toBe(false); await expect(input).toHaveValue('1.1234567'); await expect(output).toHaveText('2.12'); await expect(page.locator('.spot-status')).toHaveCount(0);
  await input.fill('1.12345678'); await expect(input).toHaveValue('1.12345678');
  await expect(page.locator('.spot-status')).toContainText('up to 7 decimal places');
  const beforeClear = calls; await input.fill(''); await input.blur();
  await expect(input).toHaveValue(''); await expect(input).toHaveAttribute('placeholder', '0.00');
  await expect(output).toHaveText('-'); await expect(page.locator('.spot-status')).toHaveCount(0);
  await expect(page.locator('.spot-quote-region')).toHaveAttribute('aria-busy', 'false');
  expect(calls).toBe(beforeClear);
  await page.reload(); await expect(input).toBeEnabled(); await expect(input).toHaveValue(''); await expect(output).toHaveText('-');
});

test('hook discovery paginates by cursor and keeps duplicate codes with shortened, distinct issuers', async ({ page }) => {
  const issuers = Array.from({ length: 32 }, () => Keypair.random().publicKey());
  const requests = [];
  let releaseSlow; const slow = new Promise(resolve => { releaseSlow = resolve; });
  await page.route(horizon + '/assets?*', async route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.searchParams.get('asset_code') === 'SLOW') {
      await slow; return route.fulfill({ json: { _embedded: { records: [{ asset_code: 'SLOW', asset_issuer: issuers[0], flags: { auth_required: false } }] } } });
    }
    const start = url.searchParams.get('cursor') === 'page-29' ? 30 : 0;
    let records = issuers.slice(start, start + 30).map((issuer, index) => ({ asset_code: 'TOKEN', asset_issuer: issuer, paging_token: 'page-' + (start + index), flags: { auth_required: false } }));
    if (url.searchParams.has('asset_issuer')) records = records.filter(record => record.asset_issuer === url.searchParams.get('asset_issuer'));
    return route.fulfill({ json: { _embedded: { records } } });
  });
  await page.goto('/spot'); await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  const search = page.getByRole('searchbox'); await search.fill('TOKEN');
  await expect(page.getByRole('option')).toHaveCount(30);
  await page.getByRole('option').first().focus();
  await expect(page.getByRole('option').first()).toContainText(issuers[0].slice(0, 6) + '…' + issuers[0].slice(-6));
  await expect(page.getByRole('option').first()).not.toContainText(issuers[0]);
  await expect(page.getByRole('button', { name: 'Copy issuer', exact: true })).toHaveCount(0);
  await expect(page.locator('.spot-asset-identity, [data-spot-assets] textarea')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more assets', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(32);
  expect(requests.some(url => url.searchParams.get('asset_code') === 'TOKEN' && url.searchParams.get('cursor') === 'page-29')).toBe(true);
  await search.fill('TOKEN:' + issuers[0]); await expect(page.getByRole('option')).toHaveCount(1);
  expect(requests.some(url => url.searchParams.get('asset_code') === 'TOKEN' && url.searchParams.get('asset_issuer') === issuers[0])).toBe(true);
  await search.fill(issuers[1]); await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('option').first().focus(); await expect(page.getByRole('option').first()).toContainText(issuers[1].slice(0, 6) + '…' + issuers[1].slice(-6));
  expect(requests.some(url => !url.searchParams.has('asset_code') && url.searchParams.get('asset_issuer') === issuers[1])).toBe(true);
  await search.fill('SLOW'); await expect.poll(() => requests.some(url => url.searchParams.get('asset_code') === 'SLOW')).toBe(true);
  await search.fill('TOKEN:' + issuers[1]); await expect(page.getByRole('option')).toHaveCount(1);
  releaseSlow();
  await expect(page.getByRole('option', { name: new RegExp('TOKEN.*' + issuers[1]) })).toBeVisible();
  await expect(page.getByRole('option', { name: /^SLOW,/ })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
});

test('single search discovers Testnet assets by code, name and issuer; only verified identities use official icons', async ({ page }) => {
  const requested = [];
  await page.route(horizon + '/assets?*', route => {
    const url = new URL(route.request().url()); requested.push(url.search);
    const records = [
      { asset_code: 'USDC', asset_issuer: circleTestnetUsdc.issuer, flags: { auth_required: false } },
      { asset_code: 'EURC', asset_issuer: circleTestnetEurc.issuer, flags: { auth_required: false } },
      { asset_code: 'EURC', asset_issuer: extraIssuer, flags: { auth_required: false } },
      { asset_code: 'USDC', asset_issuer: otherIssuer, flags: { auth_required: false } },
      ...mainnetOnly.map(asset => ({ asset_code: asset.code, asset_issuer: asset.issuer, flags: { auth_required: false } })),
    ].filter(asset => (!url.searchParams.get('asset_code') || asset.asset_code === url.searchParams.get('asset_code')) && (!url.searchParams.get('asset_issuer') || asset.asset_issuer === url.searchParams.get('asset_issuer')));
    return route.fulfill({ json: { _embedded: { records } } });
  });
  await page.goto('/spot');
  await expect(page.locator('#pay-amount')).toBeEnabled();
  for (const file of [tokenImages.native.image, circleTestnetUsdc.image]) await expect(page.locator('.asset-select img[src="' + file + '"]')).toBeVisible();
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.locator('.asset-picker-popular button')).toHaveCount(3);
  await expect(page.locator('.asset-picker-popular img[src="/tokens/stellar/eurc.svg"]')).toBeVisible();
  await expect(page.getByText(/LMXDEV|Find a Testnet asset/)).toHaveCount(0);
  const search = page.getByRole('searchbox');
  await search.fill('EURC');
  const wrongNetwork = page.getByRole('option', { name: new RegExp('EURC.*' + mainnetOnly[0].issuer) });
  await expect(wrongNetwork).toHaveAttribute('aria-disabled', 'true');
  await expect(wrongNetwork).toContainText('Mainnet');
  await wrongNetwork.click({ force: true }); await expect(page.getByRole('dialog', { name: 'Choose Testnet asset' })).toBeVisible();
  const extra = page.getByRole('option', { name: new RegExp('EURC.*' + extraIssuer) });
  await expect(extra).toBeVisible();
  await expect(extra.locator('img')).toHaveCount(0);
  await search.fill(otherIssuer);
  const unverified = page.getByRole('option', { name: new RegExp('USDC.*' + otherIssuer) });
  await expect(unverified).toBeVisible(); await expect(unverified.locator('img')).toHaveCount(0);
  await search.fill('USD Coin');
  await expect(page.getByRole('option', { name: new RegExp('USDC.*' + circleTestnetUsdc.issuer) })).toBeVisible();
  const aqua = page.getByRole('option', { name: new RegExp('AQUA.*' + mainnetOnly[1].issuer) });
  for (const typed of ['aqua', 'Aqua', 'AQUA']) {
    await search.fill(typed); await expect(search).toHaveValue(typed);
    await expect(aqua.locator('img[src="/tokens/stellar/aqua.png"]')).toBeVisible();
  }
  expect(requested.filter(query => /asset_code=aqua|asset_code=Aqua/.test(query))).toEqual([]);
  expect(requested.some(query => query.includes('asset_code=AQUA'))).toBe(true);
  await expect(aqua).toHaveAttribute('aria-disabled', 'true');
  await search.fill('EURC'); await expect(extra).toBeVisible(); await extra.click();
  await expect(page.getByRole('button', { name: /Choose receive asset: EURC/ })).toBeVisible();
  expect(requested.some(query => query.includes('asset_issuer=' + otherIssuer))).toBe(true);
});

test('issuer image metadata is nonblocking, cached, and matched to code plus issuer without conferring verification', async ({ page }) => {
  const issuerCalls = new Map(); let tomlCalls = 0;
  let release; const documentReady = new Promise(resolve => { release = resolve; });
  const assets = [
    { asset_code: 'ALPHA', asset_issuer: extraIssuer }, { asset_code: 'ALPHA', asset_issuer: otherIssuer },
    { asset_code: 'BETA', asset_issuer: otherIssuer }, { asset_code: 'BROKEN', asset_issuer: extraIssuer },
  ].map(asset => ({ ...asset, flags: { auth_required: false } }));
  await page.route(horizon + '/assets?*', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { _embedded: { records: assets.filter(asset => (!params.get('asset_code') || params.get('asset_code') === asset.asset_code) && (!params.get('asset_issuer') || params.get('asset_issuer') === asset.asset_issuer)) } } });
  });
  await page.route(horizon + '/accounts/*', route => {
    const issuer = route.request().url().split('/').pop(); issuerCalls.set(issuer, (issuerCalls.get(issuer) || 0) + 1);
    return route.fulfill({ json: { account_id: issuer, home_domain: 'tokens.example' } });
  });
  await page.route('https://tokens.example/.well-known/stellar.toml', async route => {
    tomlCalls++; await documentReady;
    const entries = [ ['ALPHA', extraIssuer, 'alpha.png'], ['ALPHA', otherIssuer, 'other-alpha.png'],
      ['BETA', extraIssuer, 'wrong-issuer.png'], ['BROKEN', extraIssuer, 'broken.png'] ];
    await route.fulfill({ contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: entries.map(([code, issuer, file]) => `[[CURRENCIES]]\ncode="${code}"\nissuer="${issuer}"\nimage="https://images.example/${file}"`).join('\n\n') });
  });
  await page.route('https://images.example/*', route => route.request().url().endsWith('/broken.png') ? route.abort()
    : route.fulfill({ contentType: 'image/svg+xml', body: require('fs').readFileSync('public' + circleTestnetUsdc.image) }));
  await page.goto('/spot'); await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  const search = page.getByRole('searchbox'); await search.fill('ALPHA');
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect.poll(() => tomlCalls).toBe(1);
  const first = page.getByRole('option', { name: new RegExp('ALPHA.*' + extraIssuer) });
  await expect(first.locator('img')).toHaveCount(0); await first.click();
  await expect(page.getByRole('button', { name: /Choose receive asset: ALPHA/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // Selection does not wait for the image.
  release();
  await expect.poll(() => page.locator('.asset-select img[src="https://images.example/alpha.png"]').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: /Choose receive asset:/ }).click(); await search.fill('ALPHA');
  await expect(first.locator('img')).toHaveAttribute('src', 'https://images.example/alpha.png');
  await expect(page.getByRole('option', { name: new RegExp('ALPHA.*' + otherIssuer) }).locator('img')).toHaveAttribute('src', 'https://images.example/other-alpha.png');
  await expect(page.locator('.asset-picker-popular button')).toHaveCount(3);
  await search.fill('BETA');
  const mismatch = page.getByRole('option', { name: /^BETA,/ });
  await expect(mismatch).toBeVisible(); await expect(mismatch.locator('img')).toHaveCount(0); // The TOML entry uses another issuer.
  await search.fill('BROKEN');
  const broken = page.getByRole('option', { name: /^BROKEN,/ });
  await expect(broken.locator('.spot-token-icon')).toHaveText('BR'); await expect(broken.locator('img')).toHaveCount(0);
  await search.fill('ALPHA'); await expect(page.getByRole('option')).toHaveCount(2);
  expect(tomlCalls).toBe(1); expect(issuerCalls.get(extraIssuer)).toBe(1); expect(issuerCalls.get(otherIssuer)).toBe(1);
});

test('missing, blocked and invalid issuer metadata leave search and selection usable with clean icon fallbacks', async ({ page }) => {
  const fixtures = ['MISSING', 'BLOCKED', 'INVALID'].map(code => ({ code, issuer: Keypair.random().publicKey() }));
  const documentCalls = [];
  await page.route(horizon + '/assets?*', route => {
    const code = new URL(route.request().url()).searchParams.get('asset_code');
    return route.fulfill({ json: { _embedded: { records: fixtures.filter(asset => asset.code === code).map(asset => ({ asset_code: asset.code, asset_issuer: asset.issuer, flags: { auth_required: false } })) } } });
  });
  await page.route(horizon + '/accounts/*', route => {
    const issuer = route.request().url().split('/').pop(); const asset = fixtures.find(asset => asset.issuer === issuer);
    return route.fulfill({ json: { account_id: issuer, ...(asset.code === 'MISSING' ? {} : { home_domain: asset.code.toLowerCase() + '.example' }) } });
  });
  await page.route('https://*.example/.well-known/stellar.toml', route => {
    documentCalls.push(route.request().url());
    return route.request().url().includes('blocked.') ? route.abort() : route.fulfill({ contentType: 'text/plain', body: '[[CURRENCIES]\ninvalid TOML' });
  });
  await page.goto('/spot');
  for (const asset of fixtures) {
    await page.getByRole('button', { name: /Choose receive asset:/ }).click(); await page.getByRole('searchbox').fill(asset.code);
    const option = page.getByRole('option', { name: new RegExp(asset.code + '.*' + asset.issuer) });
    await expect(option).toBeVisible();
    if (asset.code !== 'MISSING') await expect.poll(() => documentCalls.some(url => url.includes(asset.code.toLowerCase() + '.example'))).toBe(true);
    await option.click();
    const selected = page.getByRole('button', { name: new RegExp('Choose receive asset: ' + asset.code) });
    await expect(selected.locator('.spot-token-icon')).toHaveText(asset.code.slice(0, 2));
    await expect(selected.locator('img')).toHaveCount(0);
  }
  expect(documentCalls.length).toBe(2); await expect(page.locator('.spot-status')).toHaveCount(0);
});

test('empty path response terminates loading; an empty direct book never suppresses a valid indirect path', async ({ page }) => {
  await page.route(`${horizon}/order_book*`, route => route.fulfill({ json: { asks: [], bids: [] } }));
  await page.route(paths, route => route.fulfill({ json: { _embedded: { records: [] } } }));
  await page.goto('/spot');
  await page.locator('#pay-amount').fill('1000');
  const empty = page.locator('.spot-status[role=status]');
  await expect(empty).toContainText('No route available for this amount');
  await expect(page.getByText('No route available', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
  await expect(page.locator('.compact-route')).toHaveCount(0);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('#spot-transaction-details dd').first()).toHaveText('\u2014');
  await expect(page.locator('#spot-transaction-details')).not.toContainText('?');
  await expect(page.locator('.spot-network')).toHaveText('NetworkStellar Testnet');
  expect(await page.locator('.spot-status').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(100);
  await page.unroute(paths);
  await page.route(paths, route => {
    const json = fakePath('10', '7.5'); json._embedded.records[0].path = [{ asset_type: 'credit_alphanum12', asset_code: registry.assets[0].code, asset_issuer: registry.assets[0].issuer }];
    return route.fulfill({ json });
  });
  await page.locator('#pay-amount').fill('10');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('7.50');
  await page.getByRole('button', { name: /Selected execution path/ }).click();
  await expect(page.locator('#route-details')).toContainText('XLM'); await expect(page.locator('#route-details')).toContainText('EURC');
  await expect(page.locator('#route-details')).not.toContainText(/Blux|orderbook|quote source/i);
});

test('quotes an unheld receiving asset by its full Testnet identity and distinguishes malformed replies from absent liquidity', async ({ page }) => {
  const requested = [];
  await page.route(horizon + '/assets?*', route => route.fulfill({ json: { _embedded: { records: [
    { asset_code: 'EURC', asset_issuer: extraIssuer, flags: { auth_required: false } },
  ] } } }));
  await page.route(paths, route => {
    const url = new URL(route.request().url()); requested.push(url);
    const [code, issuer] = url.searchParams.get('destination_assets').split(':');
    const result = fakePath(url.searchParams.get('source_amount'), issuer === extraIssuer ? '7.7512345' : '23.4512345');
    result._embedded.records[0].destination_asset_code = code;
    result._embedded.records[0].destination_asset_issuer = issuer;
    result._embedded.records[0].path = [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: circleTestnetUsdc.issuer }];
    return route.fulfill({ json: result });
  });
  await page.goto('/spot');
  await page.locator('#pay-amount').fill('1000');
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await page.getByRole('option', { name: new RegExp('EURC.*' + circleTestnetEurc.issuer) }).click();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('23.45');
  expect(requested.some(url => url.searchParams.get('destination_assets') === 'EURC:' + circleTestnetEurc.issuer)).toBe(true);
  expect(requested.every(url => !url.searchParams.has('destination_account'))).toBe(true);
  await expect.poll(() => page.locator('.asset-select img[src="/tokens/stellar/eurc.svg"]').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('#spot-transaction-details')).toContainText('23.38 EURC');
  const edges = await page.locator('.spot-transaction-info').evaluate(element => {
    const rect = element.getBoundingClientRect(), row = element.querySelector('.trade-breakdown-row').getBoundingClientRect();
    return { left: row.left - rect.left, right: rect.right - row.right };
  });
  expect(edges.left).toBeGreaterThanOrEqual(8); expect(edges.left).toBe(edges.right);
  await page.screenshot({ path: '.impeccable/review/spot-ready-desktop.png' });
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await page.getByRole('searchbox').fill(extraIssuer);
  await page.getByRole('option', { name: new RegExp('EURC.*' + extraIssuer) }).click();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('7.75');
  expect(requested.at(-1).searchParams.get('destination_assets')).toBe('EURC:' + extraIssuer);
  await page.route(paths, route => route.fulfill({ json: fakePath('2', '100') }));
  await page.locator('#pay-amount').fill('2');
  await expect(page.locator('.spot-status[role=alert]')).toContainText('did not match the selected assets');
  await expect(page.locator('.spot-status--warning')).toHaveCount(0);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
});
test('debounced input ignores late replies and clears quotes for invalid precision, identical assets and invalid input', async ({ page }) => {
  await page.route(paths, async route => {
    const amount = new URL(route.request().url()).searchParams.get('source_amount');
    if (amount === '1') await new Promise(resolve => setTimeout(resolve, 1600));
    await route.fulfill({ json: fakePath(amount, amount === '1' ? '100' : amount === '2' ? '4' : '10') });
  });
  await page.goto('/spot');
  await page.locator('#pay-amount').fill('1'); await page.waitForTimeout(500); await page.locator('#pay-amount').fill('2');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('4.00'); await page.waitForTimeout(1700);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('4.00');
  await page.locator('#pay-amount').fill('1000.1234567'); await expect(page.locator('#pay-amount')).toHaveValue('1000.1234567');
  await page.locator('#pay-amount').fill('1.12345678');
  await expect(page.locator('.spot-workspace [role=alert]')).toContainText('up to 7 decimal places'); await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
  await page.locator('#pay-amount').fill('2'); await expect(page.getByLabel('Estimated receive amount')).toHaveText('4.00');
  await page.locator('#pay-amount').fill('1e2'); await expect(page.locator('#pay-amount')).toHaveValue('2'); await expect(page.locator('.spot-workspace [role=alert]')).toHaveCount(0); await expect(page.getByLabel('Estimated receive amount')).toHaveText('4.00');
  await page.locator('#pay-amount').fill('2'); await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await page.getByRole('option', { name: /^XLM,/ }).click();
  await expect(page.locator('.spot-workspace [role=alert]')).toContainText('Choose different assets'); await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
});
test('wrong endpoint and network failures show errors, never fake quotes or a Mainnet fallback', async ({ page }) => {
  await page.route(horizon, route => route.fulfill({ json: { network_passphrase: 'Public Global Stellar Network ; September 2015' } }));
  await page.goto('/spot'); await expect(page.locator('.spot-workspace [role=alert]')).toContainText('not Stellar Testnet');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
  await page.unroute(horizon); await page.route(`${horizon}/**`, route => route.abort()); await page.route(horizon, route => route.abort());
  await page.reload();
  await expect(page.locator('.spot-workspace [role=alert]')).toContainText('Testnet connection unavailable'); await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
});
test('failed quote refresh clears cached output and cannot leave a usable stale quote', async ({ page }) => {
  await page.goto('/spot'); await page.locator('#pay-amount').fill('1000'); await expect(page.getByLabel('Estimated receive amount')).toHaveText('935.86');
  await page.route(paths, route => route.abort());
  await page.locator('#pay-amount').fill('12');
  await expect(page.locator('.spot-workspace [role=alert]')).toContainText('Quote unavailable');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
  await page.locator('#pay-amount').fill('13');
  await expect(page.locator('.spot-workspace [role=alert]')).toContainText('Quote unavailable');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
});
test('quotes refresh quietly every 30 seconds, deduplicate in-flight refreshes, pause when hidden and clear on failure', async ({ page }) => {
  await page.clock.install();
  let calls = 0; let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(paths, async route => {
    calls++;
    if (calls > 1) await held;
    return route.fulfill({ json: fakePath('1000', calls > 1 ? '936.204321' : '935.8557516') });
  });
  await page.goto('/spot');
  await page.locator('#pay-amount').fill('1000'); await page.clock.runFor(400);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('935.86');
  const firstCalls = calls;
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('#spot-transaction-details .trade-breakdown-row')).toHaveCount(4);
  await expect(page.locator('#spot-transaction-details')).toContainText('933.05 USDC');
  await expect(page.locator('.spot-workspace')).not.toContainText(/Blux|Quote expired|Fee details/);
  await page.clock.fastForward(31000);
  await expect.poll(() => calls).toBe(firstCalls + 1);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('935.86');
  await expect(page.locator('.spot-quote-region')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.compact-route-copy')).toContainText('Updating quote · Previous estimate');
  await page.clock.fastForward(31000);
  expect(calls).toBe(firstCalls + 1);
  release();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('936.20');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  const beforeHidden = calls;
  await page.clock.fastForward(61000); expect(calls).toBe(beforeHidden);
  await page.route(paths, route => route.abort());
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.spot-workspace [role=alert]')).toContainText('Quote unavailable');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
});

test('mobile selector, issuer discovery, precision controls and icon fallback stay usable with keyboard and touch', async ({ page }) => {
  await page.route(horizon + '/assets?*', route => route.fulfill({ json: { _embedded: { records: mainnetOnly.map(asset => ({ asset_code: asset.code, asset_issuer: asset.issuer, flags: { auth_required: false } })) } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/spot'); await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Slippage settings', exact: true }).click();
  await page.getByLabel('Custom slippage percentage').fill('0.01');
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('.spot-network')).toContainText('Stellar Testnet');
  await expect(page.getByText('Choose the assets you want to exchange.', { exact: true })).toBeVisible();
  await expect(page.locator('.spot-intro p')).toHaveText('Swap your assets.');
  await expect(page.locator('#spot-transaction-details .trade-breakdown-row').filter({ hasText: 'Slippage' })).toContainText('0.01%');
  await page.getByLabel('Custom slippage percentage').fill('0.001'); await expect(page.locator('.spot-workspace [role=alert]')).toContainText('Check slippage');
  await page.getByLabel('Custom slippage percentage').fill('0.3'); await page.getByRole('button', { name: 'Slippage settings', exact: true }).click();
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  const search = page.getByRole('searchbox'); await expect(search).toBeFocused();
  await expect.poll(() => page.locator('[data-spot-assets] .asset-picker-header').evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await search.press('ArrowDown'); await expect(page.getByRole('option').first()).toBeFocused();
  await page.getByRole('option').first().press('End'); await expect(page.getByRole('option').last()).toBeFocused();
  await expect(page.locator('.asset-picker-popular img[src="/tokens/stellar/eurc.svg"]')).toBeVisible();
  await search.fill('AQUA');
  const aqua = page.getByRole('option', { name: /^AQUA,/ });
  await expect(aqua).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => aqua.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/spot-selector-mobile.png' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Choose Testnet asset' })).toHaveCount(0);
  await page.screenshot({ path: '.impeccable/review/spot-mobile.png' });
  await page.route('**/tokens/stellar/usdc.svg', route => route.abort()); await page.reload();
  await expect(page.locator('.asset-select .spot-token-icon').last()).toHaveText('US');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
  test(`focused swap dialogs on ${width}px: retained review, restored popups and clear route icons`, async ({ page, context }) => {
    const { Networks, TransactionBuilder } = require('@stellar/stellar-sdk');
    const { installSpotTestWallet } = require('./helpers/spot-wallet.cjs');
    const trader = Keypair.random(), address = trader.publicKey();
    await installSpotTestWallet(context, trader);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.addInitScript(theme => localStorage.setItem('lumix-theme', theme), theme);
    let releaseSubmit; const submitReady = new Promise(resolve => { releaseSubmit = resolve; });
    let submissions = 0, transactionHash, confirmation;
    const account = { account_id: address, id: address, sequence: '10000', subentry_count: 1, data_attr: {},
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      signers: [{ key: address, type: 'ed25519_public_key', weight: 1 }], flags: { auth_required: false },
      balances: [{ asset_type: 'native', balance: '10000.0000000', selling_liabilities: '0', buying_liabilities: '0' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: circleTestnetUsdc.issuer, balance: '1000.0000000', limit: '1000000', selling_liabilities: '0', buying_liabilities: '0', is_authorized: true }] };
    // Every Horizon request is fulfilled locally. No transaction reaches Testnet.
    await page.route(horizon + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ json: { network_passphrase: Networks.TESTNET } });
      if (url.pathname.startsWith('/accounts/')) return route.fulfill({ json: account });
      if (url.pathname === '/ledgers') return route.fulfill({ json: { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100, closed_at: new Date().toISOString() }] } } });
      if (url.pathname === '/assets') return route.fulfill({ json: { _embedded: { records: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: circleTestnetUsdc.issuer, flags: { auth_required: false } }] } } });
      if (url.pathname === '/paths/strict-send') return route.fulfill({ json: fakePath(url.searchParams.get('source_amount'), '114.4') });
      if (url.pathname === '/transactions' && route.request().method() === 'POST') {
        submissions++;
        const xdr = new URLSearchParams(route.request().postData()).get('tx');
        transactionHash = Buffer.from(TransactionBuilder.fromXDR(xdr, Networks.TESTNET).hash()).toString('hex');
        await submitReady;
        confirmation = { successful: true, hash: transactionHash, ledger: 1234567, fee_charged: '100000', envelope_xdr: xdr };
        return route.fulfill({ json: confirmation });
      }
      if (url.pathname === '/transactions/' + transactionHash && confirmation) return route.fulfill({ json: confirmation });
      if (url.pathname.endsWith('/operations')) return route.fulfill({ json: { _embedded: { records: [{ type: 'path_payment_strict_send', amount: '114.4' }] } } });
      return route.fulfill({ status: 404, json: { status: 404, detail: 'Not available in this isolated visual fixture' } });
    });
    await page.goto('/spot');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
    await page.getByRole('button', { name: /Freighter/ }).click();
    await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
    await page.locator('#pay-amount').fill('123');
    await page.locator('.compact-route-summary').click();
    await expect(page.locator('.route-hops .spot-route-asset')).toHaveCount(2);
    expect(await page.locator('.route-hops .spot-token-icon').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(28);
    await expect.poll(() => page.locator('.route-hops img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await expect(page.locator('.route-hops img').first()).toHaveAttribute('src', tokenImages.native.image);
    await expect(page.locator('.route-hops img').last()).toHaveAttribute('src', circleTestnetUsdc.image);
    expect(await page.locator('.compact-route').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator('.compact-route').screenshot({ path: `.impeccable/review/spot-route-hops-${width}.png` });
    await page.getByRole('button', { name: 'Review swap', exact: true }).click();
    const dialog = page.locator('[data-spot-review] .review-modal');
    await expect(dialog.getByRole('heading', { name: 'Confirm swap', exact: true })).toBeVisible();
    await expect(dialog.locator('.spot-review-amount')).toHaveText(['123.00', '≈ 114.40']);
    await expect(dialog).not.toContainText('Wallet approval is required');
    await expect(dialog).toContainText('Minimum received'); await expect(dialog).toContainText('Stellar Testnet');
    expect(await dialog.locator('.trade-breakdown-row dt').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    for (const icon of [tokenImages.native.image, circleTestnetUsdc.image]) await expect(dialog.locator('img[src="' + icon + '"]')).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const routeGap = await dialog.evaluate(el => el.querySelector('.review-breakdown dt').getBoundingClientRect().top - el.querySelector('.spot-review-pair').getBoundingClientRect().bottom);
    expect(routeGap).toBeGreaterThanOrEqual(8); expect(routeGap).toBeLessThanOrEqual(20);
    await expect(dialog.locator('.spot-review-direction')).toBeVisible();
    await dialog.screenshot({ path: `.impeccable/review/spot-confirm-${width}.png` });
    await dialog.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve test wallet request', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Approve in wallet', exact: true })).toBeVisible();
    await expect(dialog.locator('.review-modal-head p')).toContainText('Waiting for your required wallet approval');
    const loadingColor = await dialog.locator('.signature-request').evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number));
    expect(loadingColor[2]).toBeGreaterThan(loadingColor[0]);
    await expect(dialog.locator('.signature-request strong')).toHaveText('Check your wallet');
    const spinner = dialog.locator('.pending-spinner');
    expect(await spinner.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await spinner.evaluate(el => getComputedStyle(el).animationName)).toBe('trade-spin');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Hide only the local fixture overlay for the app screenshot, then explicitly approve below.
    await page.locator('[data-test-wallet]').evaluate(el => { el.style.visibility = 'hidden'; });
    await dialog.screenshot({ path: `.impeccable/review/spot-wallet-pending-${width}.png` });
    await page.locator('[data-test-wallet]').evaluate(el => { el.style.visibility = 'visible'; });
    await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
    await expect.poll(() => submissions).toBe(1);
    await expect(dialog.getByRole('heading', { name: 'Confirming on Testnet', exact: true })).toBeVisible();
    await expect(dialog.locator('.transaction-result.is-success')).toHaveCount(0);
    await dialog.screenshot({ path: `.impeccable/review/spot-network-pending-${width}.png` });
    releaseSubmit();
    await expect(dialog.getByRole('heading', { name: 'Swap complete', exact: true })).toBeVisible();
    await expect(dialog.locator('.transaction-result.is-success strong')).toHaveText('114.40 USDC');
    await expect(dialog.locator('.transaction-result.is-success p')).toHaveText('Swap confirmed on Stellar Testnet.');
    const successLayout = await dialog.locator('.transaction-result.is-success').evaluate(el => {
      const mark = el.querySelector(':scope > span').getBoundingClientRect(), copy = el.querySelector(':scope > div').getBoundingClientRect();
      return { height: el.getBoundingClientRect().height, horizontal: mark.right <= copy.left, overflow: el.scrollWidth > el.clientWidth };
    });
    expect(successLayout.horizontal).toBe(true); expect(successLayout.height).toBeLessThan(140); expect(successLayout.overflow).toBe(false);
    await expect(dialog.getByRole('link')).toHaveAttribute('href', 'https://stellar.expert/explorer/testnet/tx/' + transactionHash);
    await dialog.screenshot({ path: `.impeccable/review/spot-success-${width}.png` });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(submissions).toBe(1);
  });
}

for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
  test(`stable initial, slow, cached, changed-asset and error layouts at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.addInitScript(theme => {
      localStorage.setItem('lumix-theme', theme);
      document.documentElement.dataset.theme = theme;
    }, theme);
    const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
    const startup = gate(), root = gate(), ledger = gate(), quote = gate(), changed = gate();
    const calls = { root: 0, ledger: 0, quote: 0 };
    let result = 'success';
    await page.route('**/_next/static/chunks/*.js', async route => { await startup.promise; await route.continue(); });
    await page.route(horizon, async route => { calls.root++; await root.promise; await route.fulfill({ json: { network_passphrase: 'Test SDF Network ; September 2015' } }); });
    await page.route(horizon + '/ledgers?*', async route => {
      calls.ledger++; await ledger.promise;
      await route.fulfill({ json: { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100 }] } } });
    });
    await page.route(paths, async route => {
      calls.quote++;
      if (result === 'changed') { await changed.promise; await route.fulfill({ json: { _embedded: { records: [] } } }); }
      else if (result === 'error') await route.abort();
      else { await quote.promise; await route.fulfill({ json: fakePath(new URL(route.request().url()).searchParams.get('source_amount'), '935.8557516') }); }
    });
    const geometry = () => page.evaluate(() => {
      const card = document.querySelector('.swap-ticket').getBoundingClientRect();
      const footer = document.querySelector('footer').getBoundingClientRect();
      // Quote comparisons grow with the available routes. The surrounding
      // ticket should retain its stable loading, result and error geometry.
      const comparison = document.querySelector('.spot-quotes');
      const comparisonHeight = comparison ? comparison.getBoundingClientRect().height + parseFloat(getComputedStyle(comparison).marginTop) : 0;
      return { card: card.height - comparisonHeight, footer: footer.top + scrollY - comparisonHeight, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const stable = (actual, initial) => {
      expect(Math.abs(actual.card - initial.card), JSON.stringify({ initial, actual })).toBeLessThanOrEqual(1);
      expect(Math.abs(actual.footer - initial.footer)).toBeLessThanOrEqual(1);
      expect(actual.overflow).toBe(false);
    };
    await page.goto('/spot', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: 'Swap assets', exact: true })).toBeVisible();
    await expect(page.locator('.spot-network')).toContainText('Stellar Testnet');
    await expect(page.getByRole('button', { name: 'Transaction details', exact: true })).toBeVisible();
    await expect(page.locator('.swap-primary-wrap button')).toBeVisible();
    await expect(page.locator('#pay-amount')).toHaveValue('');
    await expect(page.locator('#pay-amount')).toHaveAttribute('placeholder', '0.00');
    await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
    await page.evaluate(() => document.fonts.ready);
    const initial = await geometry();
    startup.release();
    // Network reads start concurrently; an untouched form never requests a quote.
    await expect.poll(() => calls).toEqual({ root: 1, ledger: 1, quote: 0 });
    await page.locator('#pay-amount').fill('1000');
    await expect.poll(() => calls.quote).toBe(1);
    await expect(page.locator('.amount-output .trade-skeleton')).toBeVisible();
    const skeleton = await page.locator('.amount-output .trade-skeleton').evaluate(element => ({ background: getComputedStyle(element).backgroundImage, color: getComputedStyle(element).color }));
    expect(skeleton.background).toContain('linear-gradient'); expect(skeleton.color).toBe('rgba(0, 0, 0, 0)');
    stable(await geometry(), initial);
    quote.release(); root.release(); ledger.release();
    await expect(page.getByLabel('Estimated receive amount')).toHaveText('935.86');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.locator('.compact-route-summary').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(width === 390 ? 80 : 64);
    stable(await geometry(), initial);
    await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
    const gaps = await page.locator('.swap-ticket').evaluate(card => {
      const network = card.querySelector('.spot-network').getBoundingClientRect();
      const disclosure = card.querySelector('.fee-summary-toggle').getBoundingClientRect();
      const rows = card.querySelector('.fee-detail-rows').getBoundingClientRect();
      const button = card.querySelector('.swap-primary-wrap button').getBoundingClientRect();
      return { network: disclosure.top - network.bottom, action: button.top - rows.bottom };
    });
    expect(gaps.network).toBeLessThanOrEqual(4); expect(gaps.action).toBeGreaterThanOrEqual(24);
    await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
    await expect(page.locator('.swap-ticket')).toHaveAttribute('data-details-expanded', 'false');
    stable(await geometry(), initial);
    await page.getByRole('link', { name: 'Options', exact: true }).click();
    await expect(page.locator('.spot-workspace')).toHaveCount(0);
    await page.getByRole('link', { name: 'Spot', exact: true }).last().click();
    await expect(page.locator('#pay-amount')).toHaveValue('');
    await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
    await page.locator('#pay-amount').fill('1000');
    await expect(page.getByLabel('Estimated receive amount')).toHaveText('935.86');
    expect(calls.quote).toBe(1);
    stable(await geometry(), initial);
    result = 'changed';
    await page.getByRole('button', { name: /Choose receive asset:/ }).click();
    await page.getByRole('option', { name: new RegExp('EURC.*' + circleTestnetEurc.issuer) }).click();
    await expect(page.locator('.amount-output .trade-skeleton')).toBeVisible();
    stable(await geometry(), initial);
    changed.release();
    await expect(page.locator('.spot-status')).toContainText('No route available for this amount');
    await expect(page.locator('.spot-status')).toHaveClass(/spot-status--warning/);
    const warning = await page.locator('.spot-status').evaluate(element => {
      const style = getComputedStyle(element); return { border: style.borderColor.match(/[\d.]+/g).slice(0, 3).map(Number), background: style.backgroundColor, text: style.color, body: getComputedStyle(element.querySelector('p')).color };
    });
    expect(warning.border[0]).toBeGreaterThan(warning.border[1]); expect(warning.border[1]).toBeGreaterThan(warning.border[2]);
    expect(warning.background).not.toBe('rgba(0, 0, 0, 0)'); expect(warning.body).toBe(warning.text);
    stable(await geometry(), initial);
    const captureWarning = (width === 390) === (theme === 'dark');
    if (captureWarning) await page.screenshot({ path: `.impeccable/review/spot-refinement-${width}-${theme}.png`, fullPage: true });
    result = 'error';
    await page.locator('#pay-amount').fill('12');
    await expect(page.locator('.spot-status[role=alert]')).toContainText('Quote unavailable');
    await expect(page.locator('.spot-status')).toHaveClass(/spot-status--error/);
    const error = await page.locator('.spot-status').evaluate(element => {
      const style = getComputedStyle(element); return { border: style.borderColor.match(/[\d.]+/g).slice(0, 3).map(Number), background: style.backgroundColor, text: style.color, body: getComputedStyle(element.querySelector('p')).color };
    });
    expect(error.border[0]).toBeGreaterThan(error.border[1]); expect(error.border[0]).toBeGreaterThan(error.border[2]);
    expect(error.background).not.toBe('rgba(0, 0, 0, 0)'); expect(error.body).toBe(error.text);
    await expect(page.getByLabel('Estimated receive amount')).toHaveText('-');
    stable(await geometry(), initial);
    if (!captureWarning) await page.screenshot({ path: `.impeccable/review/spot-refinement-${width}-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: /Choose receive asset:/ }).click();
    const search = page.getByRole('searchbox'); await expect(search).toBeFocused();
    expect(await search.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
    await expect(page.getByRole('button', { name: 'Copy issuer', exact: true })).toHaveCount(0);
    const option = page.getByRole('option', { name: new RegExp('USDC.*' + circleTestnetUsdc.issuer) });
    await expect(option).toContainText(circleTestnetUsdc.issuer.slice(0, 6) + '…' + circleTestnetUsdc.issuer.slice(-6));
    await page.screenshot({ path: `.impeccable/review/spot-assets-${width}-${theme}.png`, fullPage: true });
    await search.press('ArrowDown'); await expect(page.getByRole('option').first()).toBeFocused();
    expect(await page.getByRole('option').first().evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
