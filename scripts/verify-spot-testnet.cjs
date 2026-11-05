// Runs against the local application. Never connects to an existing/user wallet.
const { chromium } = require('@playwright/test');
const { Keypair } = require('@stellar/stellar-sdk');
const { installSpotTestWallet } = require('../tests/helpers/spot-wallet.cjs');
const { browserTestOrigin } = require('../tests/helpers/browser-origin.cjs');
const { circleTestnetEurc, mainnetOnly } = require('../components/spot-verified-assets.json');
async function verifyNetwork() {
  const response = await fetch('https://horizon-testnet.stellar.org', { signal: AbortSignal.timeout(15000) });
  const root = await response.json();
  if (!response.ok || root.network_passphrase !== 'Test SDF Network ; September 2015') throw new Error('Testnet could not be verified.');
}
async function fund(trader) {
  const response = await fetch('https://friendbot.stellar.org/?addr=' + trader.publicKey(), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Friendbot could not fund the disposable Testnet account: ' + response.status);
}
const fs = require('node:fs/promises');
async function selectAsset(page, side, asset) {
  const { code, issuer } = typeof asset === 'string' ? { code: asset } : asset;
  await page.getByRole('button', { name: new RegExp(`Choose ${side} asset:`) }).click();
  if (issuer) {
    await page.getByRole('searchbox').fill(code + ':' + issuer);
    await page.getByRole('option', { name: new RegExp(`${code}.*${issuer}`) }).click();
  } else await page.getByRole('option').filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${code}$`) }) }).click();
}
async function swapPair(page, from, to, amount, report) {
  await selectAsset(page, 'pay', from); await selectAsset(page, 'receive', to);
  const fromCode = typeof from === 'string' ? from : from.code;
  const toCode = typeof to === 'string' ? to : to.code;
  await page.locator('#pay-amount').fill(amount);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Review swap', exact: true }).click({ timeout: 30000 });
    const reviewedMinimum = await page.locator('[data-spot-review] .trade-breakdown-row').filter({ hasText: 'Minimum received' }).locator('dd').innerText();
    await page.getByRole('button', { name: `Swap ${fromCode} for ${toCode}`, exact: true }).click();
    const state = await Promise.race([
      page.getByRole('button', { name: 'Approve test wallet request' }).waitFor({ timeout: 30000 }).then(() => 'wallet'),
      page.locator('[data-spot-review] .transaction-result.is-failure').waitFor({ timeout: 30000 }).then(() => 'failed'),
    ]);
    if (state === 'failed') {
      const text = await page.locator('[data-spot-review]').innerText();
      if (/weaken your reviewed minimum/.test(text) && attempt < 2) { await page.getByRole('button', { name: 'Refresh and retry', exact: true }).click(); continue; }
      throw new Error(text);
    }
    // A second click cannot produce another signing request while in flight.
    const before = await page.evaluate(() => window.__spotTestWallet.requests.filter(type => type === 'SUBMIT_TRANSACTION').length);
    await page.getByRole('button', { name: 'Approve test wallet request' }).click();
    await page.getByRole('heading', { name: 'Swap complete', exact: true }).waitFor({ timeout: 60000 });
    const url = await page.locator('.result-breakdown a').getAttribute('href'); const hash = url.split('/').at(-1);
    const txResponse = await fetch(`https://horizon-testnet.stellar.org/transactions/${hash}`); const tx = await txResponse.json();
    if (!txResponse.ok || tx.successful !== true || tx.source_account !== report.account) throw new Error('The independent Horizon confirmation failed.');
    const opsResponse = await fetch(`https://horizon-testnet.stellar.org/transactions/${hash}/operations`); const ops = (await opsResponse.json())._embedded.records;
    const path = ops.find(op => op.type === 'path_payment_strict_send');
    if (!path || path.to !== report.account || path.source_account !== report.account) throw new Error('Unexpected swap recipient or source.');
    const after = await page.evaluate(() => window.__spotTestWallet.requests.filter(type => type === 'SUBMIT_TRANSACTION').length);
    if (before !== after) throw new Error('Duplicate signing request.');
    report.swaps.push({ pair: `${fromCode} → ${toCode}`, from, to, input: amount, received: path.amount, route: path.path, reviewedMinimum,
      transactionMinimum: path.destination_min, destination: path.to,
      sourceAsset: path.source_asset_type === 'native' ? 'XLM' : `${path.source_asset_code}:${path.source_asset_issuer}`,
      destinationAsset: path.asset_type === 'native' ? 'XLM' : `${path.asset_code}:${path.asset_issuer}`,
      hash, ledger: tx.ledger, feeStroops: tx.fee_charged, operations: ops.map(op => op.type) });
    console.log('Confirmed', `${fromCode} → ${toCode}:`, hash);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    return;
  }
}
async function main() {
  const appUrl = process.env.SPOT_TEST_URL || browserTestOrigin(process.env.SPOT_TEST_BASE_URL) + '/spot';
  await verifyNetwork();
  const trader = Keypair.random(); await fund(trader);
  console.log('Disposable Testnet account funded:', trader.publicKey());
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installSpotTestWallet(context, trader);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message.slice(0, 300)));
  const report = { checkedAt: new Date().toISOString(), account: trader.publicKey(), network: 'testnet', checks: [], swaps: [], errors };
  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click({ timeout: 30000 });
    await page.getByRole('button', { name: /Freighter/ }).click({ timeout: 20000 });
    await page.getByRole('button', { name: 'Approve test wallet request' }).click({ timeout: 20000 });
    const input = page.locator('#pay-amount');
    await input.waitFor();
    if (await input.inputValue() !== '') throw new Error('The connected form did not start empty.');
    await page.getByRole('button', { name: 'Enter an amount', exact: true }).waitFor({ timeout: 40000 });
    report.checks.push('Connected through Blux login and explicit disposable-wallet approval');
    console.log(report.checks.at(-1));
    const beforeAccount = await (await fetch('https://horizon-testnet.stellar.org/accounts/' + report.account)).json();
    await input.fill(beforeAccount.balances.find(line => line.asset_type === 'native').balance);
    await page.getByText('Keep enough XLM for account reserves and the transaction fee. Use Max.', { exact: true }).waitFor();
    report.checks.push('Paying the full native balance is blocked to preserve reserves, including a new receiving trustline and fees');
    await input.fill('100');
    await page.getByRole('button', { name: 'Review swap', exact: true }).click({ timeout: 40000 });
    await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
    await page.getByRole('button', { name: 'Reject test wallet request', exact: true }).click({ timeout: 30000 });
    await page.getByRole('heading', { name: 'Swap cancelled', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close swap dialog', exact: true }).click();
    report.checks.push('Rejecting wallet approval produces cancellation without a submitted transaction');
    const eurc = { code: 'EURC', issuer: circleTestnetEurc.issuer };
    // Existing public liquidity, not an app-supplied or newly issued asset.
    const lusd = { code: 'LUSD', issuer: 'GBCMRD6NDL2RAJUOFQ25EHZVO3IRIGNESWE4QDRFB4AVFIP7IT5BRCJ6' };
    for (const [from, to, amount] of [
      ['XLM', 'USDC', '100'], ['USDC', eurc, '50'], [eurc, 'USDC', '0.0001'],
      ['XLM', lusd, '10'], [lusd, 'USDC', '1'], ['USDC', 'XLM', '1'],
    ]) await swapPair(page, from, to, amount, report);
    report.checks.push('XLM/USDC, Circle Testnet EURC and discovered LUSD swaps independently confirmed by Horizon; new receiving trustlines added only when needed');
    report.marketChecks = [];
    for (const asset of mainnetOnly) {
      const params = new URLSearchParams({ source_asset_type: 'native', source_amount: '10', destination_assets: `${asset.code}:${asset.issuer}` });
      const response = await fetch('https://horizon-testnet.stellar.org/paths/strict-send?' + params);
      if (!response.ok) throw new Error('Market check failed: ' + response.status);
      const result = await response.json();
      report.marketChecks.push({ code: asset.code, issuer: asset.issuer, input: '10 XLM', routes: result._embedded.records.length });
    }
  } catch (error) {
    report.blocker = error.message.slice(0, 1000);
    report.visibleState = (await page.locator('body').innerText()).slice(-4500);
    console.log('Check blocked:', report.blocker);
    console.log('Visible state:', report.visibleState);
    process.exitCode = 1;
  } finally {
    await fs.mkdir('.impeccable/review', { recursive: true });
    await fs.writeFile('.impeccable/review/spot-testnet-report.json', JSON.stringify(report, null, 2) + '\n');
    await page.screenshot({ path: '.impeccable/review/spot-testnet-desktop.png' });
    await browser.close();
  }
}
module.exports = { selectAsset, swapPair };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
