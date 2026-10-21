require('@next/env').loadEnvConfig(process.cwd());
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { Account, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder, contract } = require('@stellar/stellar-sdk');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const api = require('../components/spot-api.ts');
const m = require('../components/spot-utils.ts');
const soroban = require('../components/spot-soroban.ts');
const { spotApiFixture, issuer } = require('./helpers/spot-api-fixture.cjs');
const trader = Keypair.random(), address = trader.publicKey();
const request = { from: m.spotAsset('XLM', undefined, 'mainnet'), to: m.spotAsset('USDC', issuer, 'mainnet'), amount: '100', account: address };
const response = () => spotApiFixture(address);
const candidate = value => api.spotCandidates(undefined, value ?? response(), request)[0];
const spec = new contract.Spec(require('./fixtures/spot-aggregator-spec.json').entries);
test('API request preserves exact asset identities, wallet, amount and user slippage', () => {
  const body = api.spotApiBody(request, 30);
  assert.equal(body.assetIn, 'native'); assert.equal(body.assetOut, 'USDC:' + issuer);
  assert.equal(body.sender, address); assert.equal(body.amount, '100'); assert.equal(body.options.slippageBps, 30);
  assert.throws(() => api.spotApiBody({ ...request, account: undefined }, 30), /wallet/);
  assert.notEqual(m.spotRequestKey(request), m.spotRequestKey({ ...request, from: m.spotAsset('XLM') }));
});
test('valid split quotes retain API txData, protocols, allocations and hop paths', () => {
  const result = api.validateSpotApiResponse(response(), request, 30, Networks.PUBLIC);
  const quote = candidate(result);
  assert.equal(quote.source, 'soroban'); assert.equal(quote.soroban.txData, result.data[0].txData);
  assert.equal(api.spotQuoteProtocols(quote), 'Soroswap + Aquarius');
  assert.deepEqual(quote.soroban.legs.map(leg => leg.sharePct), ['60', '40']);
  assert.deepEqual(quote.soroban.legs.map(leg => leg.hops.length), [2, 1]);
  const fractionalExpiry = response();
  fractionalExpiry.data[0].expiresAt = new Date(Date.parse(fractionalExpiry.data[0].expiresAt) + 999).toISOString();
  assert.doesNotThrow(() => api.validateSpotApiResponse(fractionalExpiry, request, 30, Networks.PUBLIC));
});
test('native and Soroban candidates rank by integer net output without losing precision', () => {
  const native = { key: m.spotRequestKey(request), request, route: [request.from, request.to], output: '102.0000001' };
  assert.deepEqual(api.spotCandidates(native, response(), request).map(quote => quote.source), ['native', 'soroban']);
  native.output = '101.9999999';
  assert.deepEqual(api.spotCandidates(native, response(), request).map(quote => quote.source), ['soroban', 'native']);
  assert.equal(api.spotCandidates(native, undefined, { ...request, amount: '101' }).length, 0);
});
test('network, account, slippage and call tampering are rejected; expired quotes disappear', () => {
  const mutations = [v => v.meta.network = 'testnet', v => v.meta.slippageBps = 50,
    v => v.data[0].txData.args[0].sender = Keypair.random().publicKey(), v => v.data[0].txData.fn = 'swap_exact_out',
    v => v.data[0].txData.args[0].limit = '1', v => v.data[0].txData.args[0].legs[0].hops[0].pool = v.meta.assetOut.address,
    v => v.data[0].amountIn = '99', v => v.data[0].legs[0].path[0] = v.meta.assetOut.address,
    v => v.data[0].txData.args[0].legs[0].hops[0].protocol = { tag: 'Comet' },
    v => delete v.data[0].txData.args[0].legs[0].hops[0].protocol,
    v => v.data[0].txData.args[0].legs[0].hops[0].protocol = { tag: 'Soroswap', extra: 'Comet' },
    v => v.data[0].minimumReceivedRaw = '1', v => v.data.push(v.data[0])];
  for (const mutate of mutations) { const value = response(); mutate(value); assert.throws(() => api.validateSpotApiResponse(value, request, 30, Networks.PUBLIC)); }
  const value = spotApiFixture(address, { expires: Math.floor(Date.now() / 1000) - 1 });
  assert.equal(api.validateSpotApiResponse(value, request, 30, Networks.PUBLIC).data.length, 0);
});
function envelope(quote = candidate(), { fee = '10000', target = quote.soroban.txData.address, fn = quote.soroban.txData.fn, args = quote.soroban.txData.args, extra } = {}) {
  const encoded = spec.funcArgsToScVals(fn, { request: args[0] });
  const builder = new TransactionBuilder(new Account(address, '100'), { networkPassphrase: Networks.PUBLIC, fee })
    .addOperation(new Contract(target).call(fn, ...encoded));
  if (extra) builder.addOperation(extra);
  return builder.setTimeout(180).build();
}
test('ABI-encoded aggregator envelope preserves every API argument and signed hash', () => {
  const quote = candidate(), tx = envelope(quote);
  const checked = soroban.inspectSorobanSpotEnvelope(tx.toXDR(), quote);
  tx.sign(trader);
  assert.equal(m.spotEnvelopeHash(tx.toXDR(), 'mainnet'), checked.hash);
  assert.doesNotThrow(() => m.verifySignedSpotEnvelope(tx.toXDR(), checked, Date.now(), 'mainnet'));
});
test('changed aggregator, arguments, extra operations, excessive fee and expiry cannot be signed', () => {
  const quote = candidate();
  assert.throws(() => soroban.inspectSorobanSpotEnvelope(envelope(quote, { target: quote.soroban.legs[0].hops[0].poolAddress }).toXDR(), quote), /aggregator call changed/);
  const args = structuredClone(quote.soroban.txData.args); args[0].amount = '999';
  assert.throws(() => soroban.inspectSorobanSpotEnvelope(envelope(quote, { args }).toXDR(), quote), /aggregator call changed/);
  const protocolArgs = structuredClone(quote.soroban.txData.args); protocolArgs[0].legs[0].hops[0].protocol = { tag: 'Comet' };
  assert.throws(() => soroban.inspectSorobanSpotEnvelope(envelope(quote, { args: protocolArgs }).toXDR(), quote), /aggregator call changed/);
  assert.throws(() => soroban.inspectSorobanSpotEnvelope(envelope(quote, { fee: '10000001' }).toXDR(), quote), /fee/);
  assert.throws(() => soroban.inspectSorobanSpotEnvelope(envelope(quote, { extra: Operation.payment({ destination: address, asset: Asset.native(), amount: '1' }) }).toXDR(), quote), /does not match/);
  assert.throws(() => soroban.inspectSorobanSpotEnvelope(envelope(quote).toXDR(), quote, Date.parse(quote.soroban.expiresAt)), /expired/);
});
test('Soroban prerequisites require receiving trustline and reserve plus simulated fee budget', () => {
  const quote = candidate(), balances = [{ asset_type: 'native', balance: '102' }];
  const account = { account_id: address, subentry_count: 1, balances };
  assert.match(soroban.sorobanSpotValidation(account, quote, 5000000n), /trustline/);
  balances.push({ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer, balance: '0', limit: '100000' });
  assert.match(soroban.sorobanSpotValidation(account, quote, 5000000n), /1 XLM/);
  balances[0].balance = '103'; assert.equal(soroban.sorobanSpotValidation(account, quote, 5000000n), undefined);
});
test('native Mainnet quotes still execute as ordinary Stellar path payments', () => {
  const path = { source_asset_type: 'native', source_amount: '100', destination_asset_type: 'credit_alphanum4',
    destination_asset_code: 'USDC', destination_asset_issuer: issuer, destination_amount: '99', path: [] };
  const quote = m.quoteFromPaths([path], request);
  assert.equal(quote.route[0].network, 'mainnet'); assert.equal(quote.route[1].network, 'mainnet');
  const account = { account_id: address, subentry_count: 1, balances: [{ asset_type: 'native', balance: '1000' },
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer, balance: '0', limit: '100000' }] };
  const tx = new TransactionBuilder(new Account(address, '1'), { networkPassphrase: Networks.PUBLIC, fee: '100000' })
    .addOperation(Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: '100', destAsset: new Asset('USDC', issuer),
      destination: address, destMin: m.minimumReceived('99', 30), path: [] })).setTimeout(180).build();
  assert.equal(m.inspectSpotEnvelope(tx.toXDR(), quote, 30, account, 5000000n).hash, m.spotEnvelopeHash(tx.toXDR(), 'mainnet'));
});
test('unconfigured quote proxy never contacts an upstream service', async t => {
  const { GET, POST } = require('../app/api/spot/quotes/route.ts');
  const originalFetch = global.fetch, originalUrl = process.env.LUMIX_API_URL;
  t.after(() => { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.LUMIX_API_URL; else process.env.LUMIX_API_URL = originalUrl; });
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('No API should be contacted'); };
  for (const url of [undefined, '', '   ']) {
    if (url === undefined) delete process.env.LUMIX_API_URL; else process.env.LUMIX_API_URL = url;
    const config = GET();
    assert.equal(config.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await config.json(), { enabled: false });
    const result = await POST(new Request('http://localhost/api/spot/quotes', { method: 'POST', body: JSON.stringify(api.spotApiBody(request, 30)) }));
    assert.equal(result.status, 503);
    assert.equal(calls, 0);
  }
});
test('quote proxy preserves API body and errors without caching, and handles upstream failure', async t => {
  const { GET, POST } = require('../app/api/spot/quotes/route.ts');
  const originalFetch = global.fetch, originalUrl = process.env.LUMIX_API_URL;
  t.after(() => { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.LUMIX_API_URL; else process.env.LUMIX_API_URL = originalUrl; });
  process.env.LUMIX_API_URL = '  http://127.0.0.1:8123  ';
  assert.deepEqual(await GET().json(), { enabled: true });
  const body = JSON.stringify(api.spotApiBody(request, 30));
  let captured;
  global.fetch = async (url, options) => { captured = { url: String(url), options }; return Response.json(response()); };
  const result = await POST(new Request('http://localhost/api/spot/quotes', { method: 'POST', body }));
  assert.equal(captured.url, 'http://127.0.0.1:8123/v1/spot/quotes'); assert.equal(captured.options.body, body);
  assert.equal(captured.options.cache, 'no-store'); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).data[0].txData.address, response().data[0].txData.address);
  global.fetch = async () => Response.json({ error: { message: 'Spot quotes are not configured' } }, { status: 503 });
  assert.equal((await POST(new Request('http://localhost', { method: 'POST', body }))).status, 503);
  global.fetch = async () => { throw new Error('internal secret'); };
  const failure = await POST(new Request('http://localhost', { method: 'POST', body }));
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /internal secret/);
  assert.equal((await POST(new Request('http://localhost', { method: 'POST', body: 'bad json' }))).status, 400);
  assert.equal((await POST(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(16385) }))).status, 413);
});
