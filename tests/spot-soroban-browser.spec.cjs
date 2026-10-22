require('@next/env').loadEnvConfig(process.cwd());
const { test, expect } = require('@playwright/test');
const { Address, Asset, Keypair, Networks, TransactionBuilder, nativeToScVal, scValToNative, xdr } = require('@stellar/stellar-sdk');
const { installSpotTestWallet } = require('./helpers/spot-wallet.cjs');
const { spotApiFixture, issuer, aggregator } = require('./helpers/spot-api-fixture.cjs');
const entries = require('./fixtures/spot-aggregator-spec.json').entries;
const horizon = 'https://horizon.stellar.org';
const mainnetRpc = process.env.NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL || 'https://mainnet.sorobanrpc.com';
const leb = n => { const bytes = []; do { const b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(bytes); };
const name = Buffer.from('contractspecv0');
const section = Buffer.concat([leb(name.length), name, ...entries.map(value => Buffer.from(value, 'base64'))]);
const wasm = Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0]), leb(section.length), section]);

async function setup(page, context, { apiEnabled = true, configError = false } = {}) {
  const trader = Keypair.random(), address = trader.publicKey();
  await installSpotTestWallet(context, trader, { signingNetwork: Networks.PUBLIC });
  let hash, signedCall, nativeOperations, submissions = 0, requests = [], quoteError = false;
  const account = { account_id: address, id: address, sequence: '10000', subentry_count: 1, data_attr: {},
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, signers: [], flags: { auth_required: false },
    balances: [{ asset_type: 'native', balance: '10000', selling_liabilities: '0', buying_liabilities: '0' },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer, balance: '1000', limit: '1000000', selling_liabilities: '0', buying_liabilities: '0', is_authorized: true }] };
  // Fulfill every chain request locally. No transaction leaves the test browser.
  await page.route('https://horizon-testnet.stellar.org/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/' ? { network_passphrase: Networks.TESTNET }
      : path === '/ledgers' ? { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100 }] } }
      : path.startsWith('/accounts/') ? account : { _embedded: { records: [] } } });
  });
  await page.route(horizon + '/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ json: { network_passphrase: Networks.PUBLIC } });
    if (url.pathname.startsWith('/accounts/')) return route.fulfill({ json: account });
    if (url.pathname === '/ledgers') return route.fulfill({ json: { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100, closed_at: new Date().toISOString() }] } } });
    if (url.pathname === '/assets') return route.fulfill({ json: { _embedded: { records: [{ asset_code: 'USDC', asset_issuer: issuer, flags: { auth_required: false } }] } } });
    if (url.pathname === '/paths/strict-send') return route.fulfill({ json: { _embedded: { records: [{ source_asset_type: 'native', source_amount: url.searchParams.get('source_amount'), destination_asset_type: 'credit_alphanum4', destination_asset_code: 'USDC', destination_asset_issuer: issuer, destination_amount: '100', path: [] }] } } });
    if (url.pathname === '/transactions' && route.request().method() === 'POST') {
      const tx = TransactionBuilder.fromXDR(new URLSearchParams(route.request().postData()).get('tx'), Networks.PUBLIC);
      submissions++; nativeOperations = tx.operations; hash = Buffer.from(tx.hash()).toString('hex');
      return route.fulfill({ json: { hash, successful: true, fee_charged: '100000', ledger: 123456 } });
    }
    if (url.pathname === '/transactions/' + hash) return route.fulfill({ json: { hash, successful: true, fee_charged: '1100', ledger: 123456 } });
    return route.fulfill({ json: { _embedded: { records: [] } } });
  });
  await page.route('**/api/spot/quotes', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: configError ? 503 : 200, json: { enabled: apiEnabled } });
    const body = route.request().postDataJSON(); requests.push(body);
    return route.fulfill(quoteError ? { status: 503, json: { error: { message: 'Quote service offline.' } } }
      : { json: spotApiFixture(address, { amount: body.amount, bps: body.options.slippageBps }) });
  });
  const data = new xdr.SorobanTransactionData({ ext: xdr.SorobanTransactionDataExt.v0(), resourceFee: 1000n,
    resources: new xdr.SorobanResources({ footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }), instructions: 1000000, diskReadBytes: 0, writeBytes: 0 }) });
  const retval = nativeToScVal({ amount_in: 1000000000n, amount_out: 1020000000n, fee: 0n, surplus_out: 0n }).toXDR('base64');
  await page.route(mainnetRpc.replace(/\/$/, '') + '**', async route => {
    const request = route.request().postDataJSON(); let result;
    if (request.method === 'getLedgerEntries') {
      const records = request.params.keys.map(key => {
        const decoded = xdr.LedgerKey.fromXDR(key, 'base64'); let entry;
        if (decoded.type === 'account') entry = xdr.LedgerEntryData.account(new xdr.AccountEntry({ accountId: trader.xdrPublicKey(), balance: 100000000000n, seqNum: 10000n,
          numSubEntries: 1, inflationDest: null, flags: 0, homeDomain: '', thresholds: Buffer.from([1, 1, 1, 1]), signers: [], ext: xdr.AccountEntryExt.v0() }));
        else if (decoded.type === 'contractData') entry = xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ ext: xdr.ExtensionPoint.v0(),
          contract: Address.fromString(aggregator).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent,
          val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)), storage: null })) }));
        else if (decoded.type === 'contractCode') entry = xdr.LedgerEntryData.contractCode(new xdr.ContractCodeEntry({ ext: xdr.ContractCodeEntryExt.v0(), hash: Buffer.alloc(32, 7), code: wasm }));
        else throw new Error('Unexpected mocked ledger key: ' + decoded.type);
        return { key, xdr: entry.toXDR('base64'), lastModifiedLedgerSeq: 100, liveUntilLedgerSeq: 999999 };
      });
      result = { entries: records, latestLedger: 100 };
    } else if (request.method === 'simulateTransaction') result = { latestLedger: 100, transactionData: data.toXDR('base64'), minResourceFee: '1000', events: [], results: [{ auth: [], xdr: retval }] };
    else if (request.method === 'sendTransaction') {
      submissions++;
      const tx = TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC);
      hash = Buffer.from(tx.hash()).toString('hex'); signedCall = tx.operations[0].func.invokeContract;
      // Lose the RPC response after accepting it; the interface must recover
      // using its checked hash, without requesting a second signature.
      return route.abort();
    } else throw new Error('Unexpected mocked RPC method: ' + request.method);
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  await page.goto('/spot');
  const defaultNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK?.trim().toLowerCase() || 'testnet';
  await expect(page.locator('#spot-network')).toHaveValue(defaultNetwork);
  await expect(page.locator('.spot-network')).toHaveText(`NetworkStellar ${defaultNetwork === 'mainnet' ? 'Mainnet' : 'Testnet'}`);
  await page.evaluate(passphrase => { window.__spotTestWallet.network = passphrase; }, defaultNetwork === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await page.locator('#spot-network').selectOption('mainnet');
  await page.evaluate(passphrase => { window.__spotTestWallet.network = passphrase; }, Networks.PUBLIC);
  await page.locator('#pay-amount').fill('100');
  await expect(page.getByRole('radio')).toHaveCount(apiEnabled && !configError ? 2 : 1);
  return { requests, get submissions() { return submissions; }, get signedCall() { return signedCall; }, get nativeOperations() { return nativeOperations; }, setQuoteError: () => { quoteError = true; } };
}

test('without an API, Mainnet shows one native quote and submits only a Stellar path payment', async ({ page, context }) => {
  const state = await setup(page, context, { apiEnabled: false });
  await expect(page.locator('.spot-quotes-head')).toHaveText('Swap quote1 quote');
  await expect(page.getByRole('radio')).toBeChecked();
  await expect(page.locator('.spot-quotes')).not.toContainText('Soroban');
  await page.getByRole('button', { name: 'Slippage settings' }).click();
  await page.getByRole('button', { name: '0.5%', exact: true }).click();
  await page.locator('#pay-amount').fill('101');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  const dialog = page.locator('[data-spot-review] .review-modal');
  await dialog.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.submissions).toBe(1);
  expect(state.nativeOperations.map(operation => operation.type)).toEqual(['pathPaymentStrictSend']);
  expect(state.nativeOperations[0].sendAmount).toBe('101.0000000');
  expect(state.signedCall).toBeUndefined();
  expect(state.requests).toHaveLength(0);
});

test('a failed configuration check leaves the native quote usable', async ({ page, context }) => {
  const state = await setup(page, context, { configError: true });
  await expect(page.locator('.spot-quotes-head')).toHaveText('Swap quote1 quote');
  await expect(page.locator('.spot-quotes')).not.toContainText('Soroban');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  expect(state.requests).toHaveLength(0);
});

for (const width of [1440, 390]) test(`Mainnet quote selection, split details and guarded aggregator execution at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const state = await setup(page, context);
  const radios = page.getByRole('radio');
  await expect(radios.first()).toBeChecked();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('102.00');
  await radios.last().check();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('100.00');
  await radios.first().check();
  await page.locator('.spot-quote-option').first().locator('summary').click();
  await expect(page.locator('.spot-quote-option').first()).toContainText('60% allocation');
  await expect(page.locator('.spot-quote-option').first()).toContainText('40% allocation');
  await expect(page.locator('.spot-quote-option').first()).toContainText('Hop 2 · Soroswap');
  await expect(page.locator('.spot-quote-option').first()).toContainText('Hop 1 · Aquarius');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.impeccable/review/spot-soroban-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  const dialog = page.locator('[data-spot-review] .review-modal');
  await expect(dialog).toContainText('101.69 USDC');
  await expect(dialog).toContainText('Stellar Mainnet');
  await dialog.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.submissions).toBe(1);
  expect(Address.fromScAddress(state.signedCall.contractAddress).toString()).toBe(aggregator);
  expect(state.signedCall.functionName.toString()).toBe('swap_exact_in');
  const args = scValToNative(state.signedCall.args[0]);
  expect(String(args.amount)).toBe('1000000000'); expect(args.legs).toHaveLength(2);
  expect(state.requests[0].assetOut).toBe('USDC:' + issuer);
});

test('Soroban service failure leaves the native quote usable and slippage fetches a new API quote', async ({ page, context }) => {
  const state = await setup(page, context);
  await page.getByRole('button', { name: 'Slippage settings' }).click();
  await page.getByRole('button', { name: '0.5%', exact: true }).click();
  await expect.poll(() => state.requests.at(-1)?.options.slippageBps).toBe(50);
  await expect(page.getByRole('radio')).toHaveCount(2);
  state.setQuoteError();
  await page.locator('#pay-amount').fill('101');
  await expect(page.getByText(/Soroban quotes unavailable: Quote service offline/)).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
});
