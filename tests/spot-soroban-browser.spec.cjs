require('@next/env').loadEnvConfig(process.cwd());
const { test, expect } = require('@playwright/test');
const { Address, Asset, Keypair, Networks, StrKey, TransactionBuilder, nativeToScVal, scValToNative, xdr } = require('@stellar/stellar-sdk');
const { installSpotTestWallet } = require('./helpers/spot-wallet.cjs');
const { spotApiFixture, issuer, aggregator } = require('./helpers/spot-api-fixture.cjs');
const { spotSacFixture } = require('./helpers/spot-sac-fixture.cjs');
const indexedTokens = require('../components/spot-indexed-tokens.json').tokens;
const entries = require('./fixtures/spot-aggregator-spec.json').entries;
const horizon = 'https://horizon.stellar.org';
const mainnetRpc = process.env.NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL || 'https://mainnet.sorobanrpc.com';
const leb = n => { const bytes = []; do { const b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(bytes); };
const name = Buffer.from('contractspecv0');
const section = Buffer.concat([leb(name.length), name, ...entries.map(value => Buffer.from(value, 'base64'))]);
const wasm = Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0]), leb(section.length), section]);

async function setup(page, context, { apiEnabled = true, configError = false, nativeAlternatives = false, apiMinimum, apiOutput = '102', apiSplit = true, apiOutputs, shares, nativeOutput = '100', connect = true, loseSubmitResponse = true,
  contractTokens = {}, contractBalance = 5000000000n, contractOutput,
  missingTrustline = false, nativeBalance = '10000', authRequired = false, trustlineSubmit = 'success' } = {}) {
  const attributionLogs = [];
  const pageErrors = [], rpcRequests = [], pathRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.text().startsWith('[Swap Attribution]')) attributionLogs.push({ type: message.type(), text: message.text() });
  });
  const trader = Keypair.random(), address = trader.publicKey();
  await installSpotTestWallet(context, trader, { signingNetwork: Networks.PUBLIC });
  let restoreError = false, restoreReads = 0, pausedRestore, resumeRestore;
  await page.route('https://api.blux.cc/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/users') { restoreReads++; if (pausedRestore) await pausedRestore; }
    if (path === '/users' && restoreError) return route.fulfill({ status: 401, json: { status: 401, error: 'Session expired.' } });
    const result = path === '/auth/validate' ? { privacy_policy: '', terms: '', socials: [] }
      : path === '/auth' ? { challenge: `lumix-spot-fixture:${address}`, network_passphrase: Networks.PUBLIC }
      : path === '/auth/code' ? 'lumix-spot-fixture-session'
      : path === '/users' ? { auth_method: 'wallet', auth_value: 'Freighter', public_key: address, wallet: address } : undefined;
    return route.fulfill({ status: result === undefined ? 404 : 200, json: result === undefined
      ? { status: 404, error: 'Unexpected mocked Blux endpoint.' } : { status: 200, message: 'Fixture', result } });
  });
  let hash, signedCall, nativeOperations, submissions = 0, requests = [], quoteError = false, accountReads = 0;
  const envelopes = [], confirmations = new Map();
  let pausedTrustline, resumeTrustline;
  const reports = [];
  let reportError = false, pausedReport, resumeReport;
  await page.route('**/api/spot/swaps/record', async route => {
    const headers = { 'cache-control': 'no-store' };
    reports.push({ url: route.request().url(), method: route.request().method(), contentType: route.request().headers()['content-type'], payload: route.request().postDataJSON() });
    if (pausedReport) await pausedReport;
    if (reportError) return route.abort();
    return route.fulfill({ status: 202, headers, body: '' });
  });
  const account = { account_id: address, id: address, sequence: '10000', subentry_count: 1, data_attr: {},
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, signers: [], flags: { auth_required: false },
    balances: [{ asset_type: 'native', balance: nativeBalance, selling_liabilities: '0', buying_liabilities: '0' },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer, balance: '1000', limit: '1000000', selling_liabilities: '0', buying_liabilities: '0', is_authorized: true }] };
  if (missingTrustline) { account.balances.pop(); account.subentry_count = 0; }
  function applyTrustline(operation) {
    if (!account.balances.some(line => line.asset_code === operation.line.code && line.asset_issuer === operation.line.issuer)) {
      account.balances.push({ asset_type: operation.line.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
        asset_code: operation.line.code, asset_issuer: operation.line.issuer, balance: '0', limit: operation.limit, is_authorized: true });
      account.subentry_count++;
    }
  }
  // Fulfill every chain request locally. No transaction leaves the test browser.
  await page.route('https://horizon-testnet.stellar.org/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/' ? { network_passphrase: Networks.TESTNET }
      : path === '/ledgers' ? { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100 }] } }
      : path.startsWith('/accounts/') ? account : { _embedded: { records: [] } } });
  });
  await page.route(horizon + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ json: { network_passphrase: Networks.PUBLIC } });
    if (url.pathname.startsWith('/accounts/')) { accountReads++; return route.fulfill({ json: account }); }
    if (url.pathname === '/ledgers') return route.fulfill({ json: { _embedded: { records: [{ base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100, closed_at: new Date().toISOString() }] } } });
    if (url.pathname === '/assets') return route.fulfill({ json: { _embedded: { records: [{ asset_code: url.searchParams.get('asset_code') ?? 'USDC', asset_issuer: url.searchParams.get('asset_issuer') ?? issuer, flags: { auth_required: authRequired } }] } } });
    if (url.pathname === '/paths/strict-send') {
      pathRequests.push(url.href);
      const direct = { source_asset_type: 'native', source_amount: url.searchParams.get('source_amount'), destination_asset_type: 'credit_alphanum4', destination_asset_code: 'USDC', destination_asset_issuer: issuer, destination_amount: nativeOutput, path: [] };
      const indirect = { ...direct, destination_amount: '103', path: [{ asset_type: 'credit_alphanum4', asset_code: 'AQUA', asset_issuer: issuer }, { asset_type: 'credit_alphanum4', asset_code: 'EURC', asset_issuer: issuer }] };
      return route.fulfill({ json: { _embedded: { records: nativeAlternatives ? [direct, indirect] : [direct] } } });
    }
    if (url.pathname === '/transactions' && route.request().method() === 'POST') {
      const tx = TransactionBuilder.fromXDR(new URLSearchParams(route.request().postData()).get('tx'), Networks.PUBLIC);
      envelopes.push(tx);
      if (tx.operations.length === 1 && tx.operations[0].type === 'changeTrust') {
        const trustlineHash = Buffer.from(tx.hash()).toString('hex');
        if (pausedTrustline) await pausedTrustline;
        if (trustlineSubmit === 'failed') return route.fulfill({ status: 400, json: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_low_reserve'] } } } });
        applyTrustline(tx.operations[0]); account.sequence = tx.sequence;
        account.balances[0].balance = String(Number(account.balances[0].balance) - 0.01);
        const confirmation = { hash: trustlineHash, successful: true, fee_charged: '100000', ledger: 123455 };
        confirmations.set(trustlineHash, confirmation);
        if (trustlineSubmit === 'lost') return route.abort();
        return route.fulfill({ json: confirmation });
      }
      submissions++; nativeOperations = tx.operations; hash = Buffer.from(tx.hash()).toString('hex');
      tx.operations.filter(operation => operation.type === 'changeTrust').forEach(applyTrustline);
      account.balances[1].balance = '1100';
      return route.fulfill({ json: { hash, successful: true, fee_charged: '100000', ledger: 123456 } });
    }
    if (confirmations.has(url.pathname.split('/').at(-1))) return route.fulfill({ json: confirmations.get(url.pathname.split('/').at(-1)) });
    if (url.pathname === '/transactions/' + hash) return route.fulfill({ json: { hash, successful: true, fee_charged: '1100', ledger: 123456 } });
    return route.fulfill({ json: { _embedded: { records: [] } } });
  });
  await page.route('**/api/spot/quotes', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: configError ? 503 : 200, json: { enabled: apiEnabled } });
    const body = route.request().postDataJSON(); requests.push(body);
    const tokenAddress = value => value === 'native' ? Asset.native().contractId(Networks.PUBLIC)
      : value.includes(':') ? new Asset(...value.split(':')).contractId(Networks.PUBLIC) : value;
    const inputToken = tokenAddress(body.assetIn), outputToken = tokenAddress(body.assetOut);
    const metadata = address => contractTokens[address] ?? indexedTokens.find(token => token.address === address);
    const options = { amount: body.amount, bps: body.options.slippageBps,
      output: contractOutput && body.assetOut.startsWith('C') && !body.assetOut.includes(':') ? contractOutput : apiOutput,
      split: apiSplit, shares, inputToken, outputToken,
      inputDecimals: metadata(inputToken)?.decimals ?? 7, outputDecimals: metadata(outputToken)?.decimals ?? 7,
      inputSymbol: metadata(inputToken)?.symbol ?? 'XLM', outputSymbol: metadata(outputToken)?.symbol ?? 'USDC' };
    const value = spotApiFixture(body.sender, options);
    value.meta.warnings = [
      'Search is bounded to configured bridges, hops, and candidate limits; the best result is among validated candidates.',
      'Concentrated quotes cover the current tick interval only; paths requiring unindexed tick crossings are excluded.',
    ];
    if (apiOutputs) value.data = apiOutputs.map((output, index) => {
      const quote = spotApiFixture(body.sender, { ...options, output }).data[0];
      quote.id = `quote-${index}`;
      return quote;
    });
    if (apiMinimum) {
      value.data[0].minimumReceived = apiMinimum;
      value.data[0].minimumReceivedRaw = String(BigInt(Math.round(Number(apiMinimum) * 1e7)));
      value.data[0].txData.args[0].limit = value.data[0].minimumReceivedRaw;
    }
    return route.fulfill(quoteError ? { status: 503, json: { error: { message: 'Quote service offline.' } } } : { json: value });
  });
  const data = new xdr.SorobanTransactionData({ ext: xdr.SorobanTransactionDataExt.v0(), resourceFee: 1000n,
    resources: new xdr.SorobanResources({ footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }), instructions: 1000000, diskReadBytes: 0, writeBytes: 0 }) });
  const retval = nativeToScVal({ amount_in: 1000000000n, amount_out: 1020000000n, fee: 0n, surplus_out: 0n }).toXDR('base64');
  await page.route(mainnetRpc.replace(/\/$/, '') + '**', async route => {
    const request = route.request().postDataJSON(); let result;
    rpcRequests.push(request);
    if (request.method === 'getLedgerEntries') {
      const records = request.params.keys.map(key => {
        const decoded = xdr.LedgerKey.fromXDR(key, 'base64'); let entry;
        if (decoded.type === 'account') entry = xdr.LedgerEntryData.account(new xdr.AccountEntry({ accountId: trader.xdrPublicKey(), balance: 100000000000n, seqNum: BigInt(account.sequence),
          numSubEntries: account.subentry_count, inflationDest: null, flags: 0, homeDomain: '', thresholds: Buffer.from([1, 1, 1, 1]), signers: [], ext: xdr.AccountEntryExt.v0() }));
        else if (decoded.type === 'contractData') entry = xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ ext: xdr.ExtensionPoint.v0(),
          contract: Address.fromString(aggregator).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent,
          val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)), storage: null })) }));
        else if (decoded.type === 'contractCode') entry = xdr.LedgerEntryData.contractCode(new xdr.ContractCodeEntry({ ext: xdr.ContractCodeEntryExt.v0(), hash: Buffer.alloc(32, 7), code: wasm }));
        else throw new Error('Unexpected mocked ledger key: ' + decoded.type);
        return { key, xdr: entry.toXDR('base64'), lastModifiedLedgerSeq: 100, liveUntilLedgerSeq: 999999 };
      });
      result = { entries: records, latestLedger: 100 };
    } else if (request.method === 'simulateTransaction') {
      const transaction = TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC);
      const method = transaction.operations[0].func.invokeContract.functionName.toString();
      result = { latestLedger: 100, transactionData: data.toXDR('base64'), minResourceFee: '1000', events: [],
        results: [{ auth: [], xdr: method === 'balance' ? nativeToScVal(contractBalance, { type: 'i128' }).toXDR('base64') : retval }] };
    }
    else if (request.method === 'sendTransaction') {
      submissions++;
      const tx = TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC);
      envelopes.push(tx);
      hash = Buffer.from(tx.hash()).toString('hex'); signedCall = tx.operations[0].func.invokeContract;
      if (account.balances[1]) account.balances[1].balance = '1102';
      // Lost replies recover through Horizon without another signature.
      if (loseSubmitResponse) return route.abort();
      result = { hash, status: 'PENDING', latestLedger: 100, latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)) };
    } else if (request.method === 'getTransaction') {
      return route.abort();
    } else throw new Error('Unexpected mocked RPC method: ' + request.method);
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  await page.goto('/spot');
  await page.evaluate(passphrase => { window.__spotTestWallet.network = passphrase; }, Networks.PUBLIC);
  if (connect) {
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
    await page.getByRole('button', { name: /Freighter/ }).click();
    await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  }
  await page.locator('#pay-amount').fill('100');
  await expect(page.getByRole('radio')).toHaveCount(Math.min(3, 1 + (apiEnabled && !configError ? apiOutputs?.length ?? 1 : 0)));
  return { requests, reports, attributionLogs, pageErrors, rpcRequests, pathRequests, address, account, envelopes, get hash() { return hash; }, get accountReads() { return accountReads; }, get restoreReads() { return restoreReads; }, get submissions() { return submissions; }, get signedCall() { return signedCall; }, get nativeOperations() { return nativeOperations; }, setQuoteError: () => { quoteError = true; }, setRestoreError: () => { restoreError = true; },
    pauseTrustline: () => { pausedTrustline = new Promise(resolve => { resumeTrustline = resolve; }); },
    resumeTrustline: () => { resumeTrustline?.(); pausedTrustline = undefined; },
    setReportError: () => { reportError = true; },
    pauseReport: () => { pausedReport = new Promise(resolve => { resumeReport = resolve; }); },
    resumeReport: () => { resumeReport?.(); pausedReport = undefined; },
    pauseRestore: () => { pausedRestore = new Promise(resolve => { resumeRestore = resolve; }); },
    resumeRestore: () => { resumeRestore?.(); pausedRestore = undefined; },
  };
}

const swapSimulations = state => state.rpcRequests.filter(request => request.method === 'simulateTransaction'
  && TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC).operations[0].func.invokeContract.functionName.toString() === 'swap_exact_in');

for (const trustlineSubmit of ['success', 'lost']) test(`automatic trustline confirms before Soroban simulation (${trustlineSubmit} response)`, async ({ page, context }) => {
  if (trustlineSubmit === 'lost') await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, context, { missingTrustline: true, trustlineSubmit });
  state.pauseTrustline();
  await expect(page.getByRole('alert').filter({ hasText: 'Swap prerequisites' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  const dialog = page.locator('[data-spot-review] .review-modal');
  await expect(dialog).toContainText('Two wallet approvals');
  await expect(dialog).toContainText('Up to 1.01 XLM');
  await page.screenshot({ path: `.impeccable/review/spot-trustline-review-${trustlineSubmit}.png`, fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Adding USDC trustline…' })).toBeVisible();
  expect(swapSimulations(state)).toHaveLength(0);
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(dialog.getByText('Confirming trustline', { exact: true })).toBeVisible();
  await expect.poll(() => state.envelopes.length).toBe(1);
  expect(swapSimulations(state)).toHaveLength(0);
  expect(state.reports).toHaveLength(0);
  expect(state.envelopes[0].operations.map(operation => operation.type)).toEqual(['changeTrust']);
  await page.screenshot({ path: `.impeccable/review/spot-trustline-pending-${trustlineSubmit}.png`, fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.resumeTrustline();
  await expect(dialog.getByRole('heading', { name: 'Approve in wallet' })).toBeVisible();
  await expect.poll(() => swapSimulations(state).length).toBe(1);
  const simulation = TransactionBuilder.fromXDR(swapSimulations(state)[0].params.transaction, Networks.PUBLIC);
  expect(simulation.sequence).toBe('10002');
  expect(state.account.sequence).toBe('10001');
  await expect(page.locator('.receive-card .amount-card-balance')).toContainText('0.00 USDC');
  expect(state.reports).toHaveLength(0);
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.envelopes.map(tx => tx.operations.map(operation => operation.type))).toEqual([['changeTrust'], ['invokeHostFunction']]);
  expect(state.submissions).toBe(1);
  await expect.poll(() => state.reports.length).toBe(1);
  expect(state.reports[0].payload.txHash).toBe(state.hash);
  expect(state.reports[0].payload.txHash).not.toBe(Buffer.from(state.envelopes[0].hash()).toString('hex'));
  await expect(page.locator('.receive-card .amount-card-balance')).toContainText('1,102.00 USDC');
  expect(state.pageErrors).toEqual([]);
});

for (const signature of ['trustline', 'swap']) test(`automatic trustline handles rejection of the ${signature} signature`, async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  if (signature === 'swap') {
    await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approve in wallet' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Reject test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap cancelled' })).toBeVisible();
  expect(state.submissions).toBe(0); expect(state.reports).toHaveLength(0);
  expect(state.envelopes).toHaveLength(signature === 'swap' ? 1 : 0);
  expect(swapSimulations(state)).toHaveLength(signature === 'swap' ? 1 : 0);
  await page.getByRole('button', { name: 'Close swap dialog' }).click();
  await expect(page.locator('#pay-amount')).toBeEnabled();
  if (signature === 'swap') await expect(page.locator('.receive-card .amount-card-balance')).toContainText('0.00 USDC');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
});

test('automatic trustline reserve and fee budget sets MAX without a missing-trustline blocker', async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true, nativeBalance: '102.5099999' });
  await expect(page.getByRole('button', { name: 'Check balance and reserves', exact: true })).toBeDisabled();
  await expect(page.locator('.spot-status')).toContainText('additional 0.5 XLM trustline reserve');
  await page.getByRole('button', { name: 'MAX', exact: true }).click();
  await expect(page.locator('#pay-amount')).toHaveValue('99.9999999');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  expect(state.submissions).toBe(0);
});

test('automatic trustline preserves issuer authorization blockers', async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true, authRequired: true });
  await expect(page.locator('.spot-status')).toContainText('issuer authorization');
  await expect(page.getByRole('button', { name: 'Check balance and reserves', exact: true })).toBeDisabled();
  expect(state.envelopes).toHaveLength(0);
});

test('automatic trustline stops after a failed classic submission', async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true, trustlineSubmit: 'failed' });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap not completed' })).toBeVisible();
  expect(swapSimulations(state)).toHaveLength(0);
  expect(state.submissions).toBe(0); expect(state.reports).toHaveLength(0);
});

test('automatic trustline requires on-chain confirmation even if its balance entry exists', async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true, trustlineSubmit: 'lost' });
  await page.route(horizon + '/transactions/*', route => route.fulfill({ status: 503, json: { error: 'Confirmation unavailable' } }));
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap not completed' })).toBeVisible();
  await expect(page.locator('.review-modal')).toContainText('Trustline confirmation is unavailable. No swap was submitted.');
  expect(swapSimulations(state)).toHaveLength(0);
  expect(state.envelopes).toHaveLength(1); expect(state.reports).toHaveLength(0);
});

test('automatic trustline does not reuse a quote that expires during confirmation', async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true });
  await page.clock.install();
  state.pauseTrustline();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect.poll(() => state.envelopes.length).toBe(1);
  await page.clock.setSystemTime(new Date(Date.now() + 125000));
  state.resumeTrustline();
  await expect(page.getByRole('heading', { name: 'Swap not completed' })).toBeVisible();
  await expect(page.locator('.review-modal')).toContainText('This quote expired');
  expect(swapSimulations(state)).toHaveLength(0); expect(state.reports).toHaveLength(0);
});

test('automatic trustline remains bundled for a classic path-payment route', async ({ page, context }) => {
  const state = await setup(page, context, { missingTrustline: true, apiEnabled: false });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.envelopes.map(tx => tx.operations.map(operation => operation.type))).toEqual([['changeTrust', 'pathPaymentStrictSend']]);
  expect(swapSimulations(state)).toHaveLength(0); expect(state.submissions).toBe(1);
});

for (const destination of ['native', 'SEP-41']) test(`automatic trustline is skipped for a ${destination} destination`, async ({ page, context }) => {
  const state = await setup(page, context);
  if (destination === 'native') await page.getByRole('button', { name: 'Reverse XLM and USDC' }).click();
  else {
    await page.getByRole('button', { name: /Choose receive asset:/ }).click();
    await page.getByRole('searchbox').fill('HAHA');
    await page.getByRole('option', { name: /HAHA, HahaToken/ }).click();
  }
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await expect(page.locator('.review-modal')).not.toContainText('Two wallet approvals');
  await page.getByRole('button', { name: destination === 'native' ? 'Swap USDC for XLM' : 'Swap XLM for HAHA', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.envelopes.map(tx => tx.operations.map(operation => operation.type))).toEqual([['invokeHostFunction']]);
});

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

for (const source of ['native', 'soroban']) test(`${source} attribution receives 202 with the submitted Mainnet hash and sender`, async ({ page, context }) => {
  const state = await setup(page, context, { apiEnabled: source === 'soroban' });
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/spot/swaps/record' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect((await accepted).status()).toBe(202);
  expect(state.reports).toHaveLength(1);
  const report = state.reports[0];
  expect(new URL(report.url).origin).toBe(new URL(page.url()).origin);
  expect(new URL(report.url).pathname).toBe('/api/spot/swaps/record');
  expect(report.method).toBe('POST');
  expect(report.contentType).toBe('application/json');
  expect(report.payload.txHash).toBe(state.hash);
  expect(report.payload.sender).toBe(state.address);
  expect(report.payload.venue).toBe(source === 'native' ? 'STELLAR_NATIVE' : 'CONTRACT_AGGREGATOR');
  await expect.poll(() => state.attributionLogs).toContainEqual({ type: 'log', text: '[Swap Attribution] Response: 202' });
  expect(state.attributionLogs).toContainEqual({ type: 'log', text: `[Swap Attribution] Reporting ${report.payload.venue} swap ${state.hash} to API...` });
  expect(state.attributionLogs.filter(log => log.text === '[Swap Attribution] Response: 202')).toHaveLength(1);
  expect(state.attributionLogs.filter(log => log.type === 'error')).toHaveLength(0);
  if (source === 'native') expect(report.payload.route.path.map(asset => asset.code)).toEqual(['XLM', 'USDC']);
  else expect(report.payload.route.legs).toHaveLength(2);
  await expect(page.locator('.wallet-balance-control')).toHaveText(source === 'native' ? '1,100.00 USDC' : '1,102.00 USDC');
});

for (const source of ['native', 'soroban']) test(`${source} attribution latency never delays success or balance refresh`, async ({ page, context }) => {
  const state = await setup(page, context, { apiEnabled: source === 'soroban' });
  state.pauseReport();
  try {
    await page.getByRole('button', { name: 'Review swap', exact: true }).click();
    await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
    await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
    await expect.poll(() => state.reports.length).toBe(1);
    await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible({ timeout: 2500 });
    await expect(page.locator('.wallet-balance-control')).toHaveText(source === 'native' ? '1,100.00 USDC' : '1,102.00 USDC', { timeout: 2500 });
    expect(state.attributionLogs.some(log => log.text.startsWith('[Swap Attribution] Reporting '))).toBe(true);
    expect(state.attributionLogs.some(log => log.text === '[Swap Attribution] Response: 202')).toBe(false);
  } finally { state.resumeReport(); }
});

test('native attribution network failure does not become a transaction error', async ({ page, context }) => {
  const state = await setup(page, context, { apiEnabled: false });
  state.setReportError();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,100.00 USDC');
  expect(state.reports).toHaveLength(1);
  expect(state.submissions).toBe(1);
  await expect.poll(() => state.attributionLogs.some(log => log.type === 'error' && log.text.startsWith('[Swap Attribution] Error:'))).toBe(true);
  expect(state.attributionLogs.some(log => log.text === '[Swap Attribution] Response: 202')).toBe(false);
});

test('an accepted aggregator submission reports before confirmation and recovery does not report twice', async ({ page, context }) => {
  const state = await setup(page, context, { loseSubmitResponse: false });
  let resume;
  const confirmation = new Promise(resolve => { resume = resolve; });
  await page.route(mainnetRpc.replace(/\/$/, '') + '**', async route => {
    if (route.request().postDataJSON().method !== 'getTransaction') return route.fallback();
    await confirmation;
    return route.abort();
  });
  try {
    await page.getByRole('button', { name: 'Review swap', exact: true }).click();
    await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
    await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
    await expect.poll(() => state.reports.length).toBe(1);
    await expect(page.getByRole('heading', { name: /Confirming on Mainnet/ })).toBeVisible();
    await expect.poll(() => state.attributionLogs).toContainEqual({ type: 'log', text: '[Swap Attribution] Response: 202' });
    expect(state.reports[0].payload.txHash).toBe(state.hash);
    expect(state.reports[0].payload.venue).toBe('CONTRACT_AGGREGATOR');
  } finally { resume(); }
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.reports).toHaveLength(1);
});

for (const source of ['native', 'soroban']) test(`${source} wallet rejection never submits a transaction`, async ({ page, context }) => {
  const state = await setup(page, context, { apiEnabled: source === 'soroban' });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Reject test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap cancelled', exact: true })).toBeVisible();
  expect(state.submissions).toBe(0);
  expect(state.reports).toHaveLength(0);
  expect(state.attributionLogs).toHaveLength(0);
});

test('a failed configuration check leaves the native quote usable', async ({ page, context }) => {
  const state = await setup(page, context, { configError: true });
  await expect(page.getByText(/Quote configuration is unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  expect(state.requests).toHaveLength(0);
});

for (const width of [1440, 390]) test(`Mainnet quote selection, split details and guarded aggregator execution at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const state = await setup(page, context);
  const radios = page.getByRole('radio');
  await expect(radios.first()).toBeChecked();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('102.0000000');
  await page.locator('.spot-quote-choice').last().click();
  await expect(radios.last()).toBeChecked();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('100.0000000');
  await page.locator('.spot-quote-choice').first().click();
  await expect(radios.first()).toBeChecked();
  await page.getByRole('button', { name: /Selected execution path/ }).click();
  await expect(page.locator('#route-details')).toContainText('60%');
  await expect(page.locator('#route-details')).toContainText('40%');
  await expect(page.locator('.spot-quote-option').first()).toContainText('Best net received');
  await expect(page.locator('.spot-quote-output').first()).toHaveText('102.0000000 USDC');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.impeccable/review/spot-soroban-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  const dialog = page.locator('[data-spot-review] .review-modal');
  await expect(dialog).toContainText('101.694 USDC');
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

test('one best native quote is compared with protocol quotes and its path is preserved through signing', async ({ page, context }) => {
  const state = await setup(page, context, { nativeAlternatives: true });
  await expect(page.locator('.spot-quote-copy > strong', { hasText: 'Stellar AMM / order book' })).toHaveCount(1);
  await expect(page.locator('.spot-quote-option').last()).toContainText('Soroswap + Aquarius');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('103.0000000');
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.locator('.spot-quote-option').first()).toContainText('Single route');
  await page.getByRole('button', { name: /Selected execution path/ }).click();
  await expect(page.locator('#route-details .spot-route-asset > span:last-child')).toHaveText(['XLM', 'AQUA', 'EURC', 'USDC']);
  await page.locator('.spot-quote-choice').last().click();
  await expect(page.getByRole('radio').last()).toBeChecked();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('102.0000000');
  await page.locator('.spot-quote-choice').first().click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('103.0000000');
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.nativeOperations[0].path.map(asset => asset.code)).toEqual(['AQUA', 'EURC']);
  expect(state.submissions).toBe(1);
});

test('tiny outputs stay nonzero in quote rows while exact minimums remain in details and review', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, context, { apiOutput: '0.0000012', apiSplit: false, nativeOutput: '0.0000011' });
  const quotes = page.locator('.spot-quote-option');
  await expect(quotes.first()).toContainText('Soroswap');
  await expect(quotes.first().locator('.spot-quote-output')).toHaveText('0.0000012 USDC');
  await expect(quotes.last().locator('.spot-quote-output')).toHaveText('0.0000011 USDC');
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('0.0000012');
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('#spot-transaction-details')).toContainText('0.0000011 USDC');
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await expect(page.locator('.review-breakdown')).toContainText('0.0000011 USDC');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/spot-tiny-minimum-390.png', fullPage: true });
});

test('the highest net output is selected while minimums remain visible', async ({ page, context }) => {
  await setup(page, context, { apiMinimum: '101.99' });
  await page.route(horizon + '/paths/strict-send*', route => route.fulfill({ json: { _embedded: { records: [{ source_asset_type: 'native', source_amount: new URL(route.request().url()).searchParams.get('source_amount'), destination_asset_type: 'credit_alphanum4', destination_asset_code: 'USDC', destination_asset_issuer: issuer, destination_amount: '102.1', path: [] }] } } }));
  await page.locator('#pay-amount').fill('101');
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.locator('.spot-quote-option').first()).toContainText('Stellar AMM / order book');
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.locator('.spot-quote-output').first()).toHaveText('102.1000000 USDC');
  await expect(page.locator('.spot-quote-output').last()).toHaveText('102.0000000 USDC');
  await page.locator('.spot-quote-choice').last().click();
  await expect(page.getByRole('radio').last()).toBeChecked();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('102.0000000');
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('#spot-transaction-details')).toContainText('101.99 USDC');
});

for (const width of [1440, 390]) test(`seven-decimal quotes match Receive and expanded details clear the action button at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await setup(page, context, { connect: width === 1440, nativeOutput: '1.6349', apiOutputs: ['1.6356619', '1.6378674', '1.6361234'] });
  if (width === 390) await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.spot-quote-output')).toHaveText(['1.6378674 USDC', '1.6361234 USDC', '1.6356619 USDC']);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('1.6378674');
  await page.locator('.spot-quote-choice').nth(2).click();
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('1.6356619');
  await page.getByRole('button', { name: 'Transaction details', exact: true }).click();
  await expect(page.locator('#spot-transaction-details')).toContainText('Up to 1.00 XLM');
  const measureLayout = () => page.evaluate(() => {
    const rows = document.querySelector('#spot-transaction-details .fee-detail-rows');
    const lastRow = rows.lastElementChild.getBoundingClientRect();
    const button = document.querySelector('.swap-primary-wrap button').getBoundingClientRect();
    return { padding: parseFloat(getComputedStyle(rows).paddingBottom), gap: button.top - lastRow.bottom, fits: document.documentElement.scrollWidth <= innerWidth };
  });
  // Disclosure text stays mounted while the grid height animates open.
  await expect.poll(async () => (await measureLayout()).gap).toBeGreaterThanOrEqual(20);
  const layout = await measureLayout();
  expect(layout.padding).toBeGreaterThanOrEqual(20);
  expect(layout.fits).toBe(true);
  await page.screenshot({ path: `.impeccable/review/spot-precision-details-${width}.png`, fullPage: true });
});

for (const width of [1440, 390]) test(`top three quotes, fractional splits and minimal review at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const state = await setup(page, context, { apiOutputs: ['99', '104', '101', '105'], shares: ['1.562500', '98.437500'] });
  if (width === 390) await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.spot-quotes-head')).toContainText('3 quotes');
  await expect(page.locator('.spot-quote-output')).toHaveText(['105.0000000 USDC', '104.0000000 USDC', '101.0000000 USDC']);
  await expect(page.locator('.spot-quote-output > strong')).toHaveCount(3);
  await expect(page.locator('.spot-quote-copy > span:not(.spot-quote-best)')).toHaveText(['Split across 2 routes', 'Split across 2 routes', 'Split across 2 routes']);
  await expect(page.locator('.spot-quotes')).not.toContainText(/Min |Est\.|%|\bhops?\b|·/);
  await expect(page.locator('.spot-quote-toggle, .spot-quote-breakdown')).toHaveCount(0);
  await expect(page.locator('.spot-quotes + .spot-quote-region')).toHaveCount(1);
  await expect(page.locator('.swap-ticket')).not.toContainText(/Connect your wallet to swap|Search is bounded|Concentrated quotes cover/);
  expect(state.requests.at(-1).options.quoteLimit).toBe(3);
  await page.getByRole('button', { name: /Selected execution path/ }).click();
  const route = page.locator('#route-details');
  await expect(route.locator('li')).toHaveCount(2);
  await expect(route.locator('.spot-route-share')).toHaveText(['1.6%', '98.4%']);
  await expect(route.locator('.spot-route-asset')).toHaveText(['XLM', 'USDC', 'XLM', 'USDC']);
  await expect(route.locator('.spot-route-venue')).toHaveText(['(Soroswap)', '(Aquarius)']);
  await expect(route.locator('.spot-route-asset img')).toHaveCount(4);
  expect(await route.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await expect(route).not.toContainText(/Pool |constant-product|allocation|Output|Minimum|expires|Aggregator fee|·/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `.impeccable/review/spot-simplified-ticket-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm swap' });
  await expect(dialog.locator('dt')).toHaveText(['Route', 'Minimum received', 'Slippage', 'Network fee limit', 'Network']);
  await expect(dialog.locator('ol, .spot-route-splits, .spot-route-detail')).toHaveCount(0);
  await expect(dialog).not.toContainText(/Pool |constant-product|allocation|Aggregator fee/);
  await expect(dialog).toContainText('Up to 1.00 XLM');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Swap XLM for USDC', exact: true })).toBeVisible();
  await page.screenshot({ path: `.impeccable/review/spot-clean-review-${width}.png`, fullPage: true });
});

for (const apiEnabled of [true, false]) test(`single ${apiEnabled ? 'Soroban' : 'Stellar'} path uses the same icons and venue layout`, async ({ page, context }) => {
  await setup(page, context, { apiSplit: false, apiEnabled });
  await page.getByRole('button', { name: /Selected execution path/ }).click();
  await expect(page.locator('#route-details .spot-route-asset')).toHaveText(['XLM', 'USDC']);
  await expect(page.locator('#route-details .spot-route-asset img')).toHaveCount(2);
  await expect(page.locator('#route-details .spot-route-venue')).toHaveText(apiEnabled ? '(Soroswap)' : '(Stellar AMM / order book)');
  await expect(page.locator('#route-details')).not.toContainText(/Pool |allocation|Output|Minimum|expires|Aggregator fee|·/);
});

test('wallet restores after refresh and explicit disconnect removes the saved session', async ({ page, context }) => {
  const state = await setup(page, context);
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,000.00 USDC');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lumix_wallet_connected'))).toBe('blux');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lumix_wallet_type'))).toBe('blux');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lumix_wallet_address'))).toBe(state.address);
  await page.reload();
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,000.00 USDC');
  expect(await page.evaluate(() => window.__spotTestWallet.approvals)).toBe(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
  await page.locator('.account-control').click();
  await page.getByRole('menuitem', { name: 'Disconnect wallet', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('lumix_wallet_connected'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('lumix_wallet_type'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('lumix_wallet_address'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
  await expect(page.locator('.wallet-balance-control')).toHaveCount(0);
});

test('slow SDK hydration preserves the saved session beyond the old deadline without another signature', async ({ page, context }) => {
  const state = await setup(page, context, { apiEnabled: false });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lumix_wallet_type'))).toBe('blux');
  await page.clock.install();
  const restoreReads = state.restoreReads;
  state.pauseRestore();
  try {
    await page.reload();
    await expect.poll(() => state.restoreReads).toBeGreaterThan(restoreReads);
    await page.clock.fastForward(20_000);
    await expect(page.locator('.wallet-connection-message')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('lumix_wallet_type'))).toBe('blux');
    expect(await page.evaluate(() => localStorage.getItem('lumix_wallet_address'))).toBe(state.address);
    await expect(page.locator('.wallet-balance-control')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Freighter/ })).toHaveCount(0);
  } finally { state.resumeRestore(); }
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,000.00 USDC');
  await expect(page.locator('.account-control')).toContainText(state.address.slice(0, 5));
  await expect(page.locator('.wallet-connection-message')).toHaveCount(0);
  expect(await page.evaluate(() => window.__spotTestWallet.approvals)).toBe(0);
  await expect(page.getByRole('button', { name: /Freighter/ })).toHaveCount(0);
  await page.locator('#pay-amount').fill('100');
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  expect(state.submissions).toBe(1);
});

test('disconnected quote previews contain no disclaimer or duplicated route breakdown', async ({ page, context }) => {
  await setup(page, context, { connect: false });
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
  await expect(page.locator('.spot-quotes')).not.toContainText(/Min |Est\.|%|\bhops?\b|·/);
  await expect(page.locator('.spot-quote-notice')).toHaveCount(0);
  await expect(page.locator('.swap-ticket')).not.toContainText(/Connect your wallet to swap|Search is bounded|Concentrated quotes cover/);
});

test('Transaction details animates both ways and keeps collapsed content inaccessible', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page, context);
  const details = page.locator('#spot-transaction-details');
  const toggle = page.getByRole('button', { name: 'Transaction details', exact: true });
  await expect(details).toHaveAttribute('inert', '');
  expect(await details.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await toggle.click();
  await expect(details).toHaveAttribute('data-open', 'true');
  const opening = await details.evaluate(async element => {
    const transitions = element.getAnimations();
    const height = () => element.getBoundingClientRect().height;
    const start = height();
    await new Promise(resolve => setTimeout(resolve, 100));
    const middle = height();
    await Promise.all(transitions.map(animation => animation.finished));
    return { properties: transitions.map(animation => animation.transitionProperty), start, middle, end: height() };
  });
  expect(opening.properties).toContain('grid-template-rows');
  expect(opening.middle).toBeGreaterThan(opening.start);
  expect(opening.middle).toBeLessThan(opening.end);
  await expect(details).not.toHaveAttribute('inert');
  await toggle.click();
  const closing = await details.evaluate(async element => {
    const transitions = element.getAnimations();
    const start = element.getBoundingClientRect().height;
    await new Promise(resolve => setTimeout(resolve, 100));
    const middle = element.getBoundingClientRect().height;
    await Promise.all(transitions.map(animation => animation.finished));
    return { start, middle, end: element.getBoundingClientRect().height };
  });
  expect(closing.middle).toBeLessThan(closing.start);
  expect(closing.middle).toBeGreaterThan(0);
  expect(closing.end).toBe(0);
  await expect(details).toHaveAttribute('inert', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  expect(await details.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('none');
});

test('a failed saved session never authenticates from the cached public key', async ({ page, context }) => {
  const state = await setup(page, context);
  state.setRestoreError();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeEnabled();
  await expect(page.locator('.wallet-balance-control')).toHaveCount(0);
  await expect(page.locator('.wallet-connection-message')).toHaveCount(0);
  expect(await page.evaluate(() => window.__spotTestWallet.approvals)).toBe(0);
});

test('navbar and native balances refresh live without substituting a same-code USDC issuer', async ({ page, context }) => {
  const state = await setup(page, context);
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,000.00 USDC');
  state.account.balances[1].balance = '5.4321987';
  state.account.balances[0].balance = '123.4567890';
  state.account.balances.push({ ...state.account.balances[1], asset_issuer: Keypair.random().publicKey(), balance: '9999' });
  await expect(page.locator('.wallet-balance-control')).toHaveText('5.43 USDC', { timeout: 15000 });
  await expect(page.locator('.amount-card-balance').first()).toContainText('120.96 XLM');
  state.account.balances.splice(1, 1);
  await expect(page.locator('.wallet-balance-control')).toHaveText('0.00 USDC', { timeout: 15000 });
});

test('successful swap refreshes the navbar immediately rather than waiting for polling', async ({ page, context }) => {
  await setup(page, context, { apiEnabled: false });
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,000.00 USDC');
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await page.getByRole('button', { name: 'Swap XLM for USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Approve test wallet request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap complete' })).toBeVisible();
  await expect(page.locator('.wallet-balance-control')).toHaveText('1,100.00 USDC', { timeout: 5000 });
});

const hahaAddress = 'CDME3GWAU7YSHVB6GWKDOQORR6TYKKQG6G7FDMMO7OPMQALBCNI5A2JR';
for (const side of ['pay', 'receive']) test(`indexed HAHA searches and quotes by contract address in the ${side} picker without metadata RPC`, async ({ page, context }) => {
  const state = await setup(page, context);
  await page.getByRole('button', { name: new RegExp(`Choose ${side} asset:`) }).click();
  const option = page.getByRole('option', { name: new RegExp(`HAHA, HahaToken, contract ${hahaAddress}`) });
  for (const query of ['HAHA', 'haha', 'hAhAtOkEn', hahaAddress.slice(0, 26).toLowerCase(), hahaAddress.toLowerCase(), hahaAddress]) {
    await page.getByRole('searchbox').fill(query);
    await expect(option).toBeVisible();
    await expect(page.locator('.asset-picker-empty').filter({ hasText: /Searching…|Looking up asset/ })).toHaveCount(0);
    await expect(page.getByText('Contract lookup failed', { exact: true })).toHaveCount(0);
    expect(state.rpcRequests).toHaveLength(0);
  }
  const nativeReads = state.pathRequests.length;
  await option.click();
  await expect(page.getByRole('button', { name: new RegExp(`Choose ${side} asset: HAHA`) })).toBeVisible();
  if (side === 'pay') {
    await expect(page.locator('.amount-card-balance').first()).toContainText('500.00 HAHA');
    await page.getByRole('button', { name: 'MAX', exact: true }).click();
    await expect(page.locator('#pay-amount')).toHaveValue('500');
  }
  await page.locator('#pay-amount').fill('10');
  await expect.poll(() => state.requests.at(-1)).toMatchObject({ amount: '10', [side === 'pay' ? 'assetIn' : 'assetOut']: hahaAddress });
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.locator('.spot-quote-output')).toContainText('102.0000000');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  expect(state.pathRequests).toHaveLength(nativeReads);
  expect(state.rpcRequests.every(request => request.method === 'simulateTransaction'
    && TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC).operations[0].func.invokeContract.functionName.toString() === 'balance')).toBe(true);
  expect(state.requests.every(request => !JSON.stringify(request).includes(':undefined'))).toBe(true);
  expect(state.pageErrors).toEqual([]); expect(state.reports).toHaveLength(0);
  if (side === 'receive') await page.screenshot({ path: '.impeccable/review/spot-sep41-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm swap', exact: true })).toBeVisible();
  await expect(page.locator(`.spot-review-issuer[title="${hahaAddress}"]`)).toBeVisible();
});

test('indexed HAHA remains searchable and selectable on mobile without a wallet or RPC', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, context, { connect: false });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await page.getByRole('searchbox').fill('hahatoken');
  const option = page.getByRole('option', { name: new RegExp(`HAHA.*${hahaAddress}`) });
  await expect(option).toBeVisible();
  await expect(page.locator('.asset-picker-empty').filter({ hasText: 'Searching…' })).toHaveCount(0);
  await page.screenshot({ path: '.impeccable/review/spot-sep41-mobile-picker.png', fullPage: true });
  await option.click();
  await page.locator('#pay-amount').fill('10');
  await expect.poll(() => state.requests.at(-1)).toMatchObject({ assetOut: hahaAddress, amount: '10' });
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('102.0000000');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.rpcRequests).toHaveLength(0); expect(state.pageErrors).toEqual([]);
});

test('unindexed SEP-41 WASM token falls back to metadata simulation and keeps nine-decimal quotes', async ({ page, context }) => {
  const address = StrKey.encodeContract(Buffer.alloc(32, 100));
  const state = await setup(page, context, { contractTokens: { [address]: { symbol: 'NEW', decimals: 9 } }, contractOutput: '0.123456789' });
  const fixture = spotSacFixture(Asset.native(), Networks.PUBLIC, { wasm: true, address });
  const reads = [];
  await page.route(mainnetRpc.replace(/\/$/, '') + '**', route => {
    const request = route.request().postDataJSON();
    if (request.method === 'getLedgerEntries') {
      reads.push('SAC');
      return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { entries: request.params.keys.map(key => ({ key, xdr: fixture.xdr })) } } });
    }
    if (request.method === 'simulateTransaction') {
      const call = TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC).operations[0].func.invokeContract;
      const method = call.functionName.toString();
      if (['name', 'symbol', 'decimals'].includes(method)) {
        reads.push(method);
        const value = { name: 'New SEP-41 token', symbol: 'NEW', decimals: 9 }[method];
        return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { results: [{ xdr: nativeToScVal(value, { type: method === 'decimals' ? 'u32' : 'string' }).toXDR('base64') }] } } });
      }
    }
    return route.fallback();
  });
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await page.getByRole('searchbox').fill(address);
  const option = page.getByRole('option', { name: new RegExp(`NEW, New SEP-41 token, contract ${address}`) });
  await expect(option).toBeVisible();
  expect(reads[0]).toBe('SAC'); expect(reads.slice(1).sort()).toEqual(['decimals', 'name', 'symbol']);
  await expect(page.getByText('Contract lookup failed', { exact: true })).toHaveCount(0);
  await option.click();
  await page.locator('#pay-amount').fill('10');
  await expect.poll(() => state.requests.at(-1)).toMatchObject({ assetOut: address, amount: '10' });
  await expect(page.getByLabel('Estimated receive amount')).toHaveText('0.123456789');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  expect(state.pageErrors).toEqual([]); expect(state.submissions).toBe(0);
});

test('missing SEP-41 contract errors only after both lookups and clears when an indexed token matches', async ({ page, context }) => {
  await setup(page, context);
  const reads = [];
  await page.route(mainnetRpc.replace(/\/$/, '') + '**', route => {
    const request = route.request().postDataJSON();
    const method = request.method === 'simulateTransaction'
      ? TransactionBuilder.fromXDR(request.params.transaction, Networks.PUBLIC).operations[0].func.invokeContract.functionName.toString()
      : request.method;
    reads.push(method);
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: method === 'getLedgerEntries' ? { entries: [] } : { error: 'HostError: MissingValue' } } });
  });
  await page.getByRole('button', { name: /Choose receive asset:/ }).click();
  await page.getByRole('searchbox').fill(StrKey.encodeContract(Buffer.alloc(32, 101)));
  await expect(page.getByRole('alert').filter({ hasText: 'Contract lookup failed' })).toContainText('Stellar asset contract or SEP-41 token');
  expect(reads[0]).toBe('getLedgerEntries'); expect(reads.slice(1).sort()).toEqual(['decimals', 'name', 'symbol']);
  await page.getByRole('searchbox').fill('HAHA');
  await expect(page.getByRole('option', { name: /HAHA, HahaToken/ })).toBeVisible();
  await expect(page.getByText('Contract lookup failed', { exact: true })).toHaveCount(0);
});

for (const side of ['pay', 'receive']) test(`SAC address resolves in the ${side} picker without keeping stale results`, async ({ page, context }) => {
  await setup(page, context, { apiEnabled: false });
  const asset = new Asset('CUSTOM', Keypair.random().publicKey());
  const entry = spotSacFixture(asset, Networks.PUBLIC);
  await page.route(mainnetRpc.replace(/\/$/, '') + '**', route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { latestLedger: 100, entries: request.params.keys.map(key => ({ key, xdr: entry.xdr })) } } });
  });
  await page.getByRole('button', { name: new RegExp(`Choose ${side} asset:`) }).click();
  const search = page.getByRole('searchbox');
  await search.fill(entry.address);
  const option = page.getByRole('option', { name: new RegExp('CUSTOM.*' + asset.issuer) });
  await expect(option).toBeVisible();
  await search.fill('UNRELATED');
  await expect(option).toHaveCount(0);
  await search.fill(entry.address);
  await option.click();
  await expect(page.getByRole('button', { name: new RegExp(`Choose ${side} asset: CUSTOM`) })).toBeVisible();
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
