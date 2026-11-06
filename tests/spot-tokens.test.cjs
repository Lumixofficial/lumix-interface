require('@next/env').loadEnvConfig(process.cwd());
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { Address, Asset, Keypair, Networks, StrKey, TransactionBuilder, nativeToScVal } = require('@stellar/stellar-sdk');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const m = require('../components/spot-utils.ts');
const { SPOT_INDEXED_ASSETS, spotIndexedAsset, spotAssetMatches } = require('../components/spot-tokens.ts');
const { resolveSpotToken, readSpotContractBalance } = require('../components/spot-contract-token.ts');
const { sorobanSpotValidation } = require('../components/spot-soroban.ts');
const { spotSacFixture } = require('./helpers/spot-sac-fixture.cjs');
const haha = 'CDME3GWAU7YSHVB6GWKDOQORR6TYKKQG6G7FDMMO7OPMQALBCNI5A2JR';
const unknown = StrKey.encodeContract(Buffer.alloc(32, 99));
const record = overrides => ({ address: haha, name: 'HahaToken', symbol: 'HAHA', decimals: 7, issuer: null, assetCode: null, type: 'contract', ...overrides });
const token = (overrides = {}) => spotIndexedAsset(record(overrides), 'mainnet');
const encoded = value => nativeToScVal(value, typeof value === 'number' ? { type: 'u32' } : typeof value === 'bigint' ? { type: 'i128' } : { type: 'string' }).toXDR('base64');
function mockFetch(t, callback) {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async (url, options) => callback(url, JSON.parse(options.body), options);
}
function simulatedMethod(body, passphrase = Networks.PUBLIC) {
  const transaction = TransactionBuilder.fromXDR(body.params.transaction, passphrase);
  assert.equal(transaction.signatures.length, 0);
  assert.equal(transaction.operations.length, 1);
  return transaction.operations[0].func.invokeContract;
}

test('indexed HAHA is a contract identity with null classic fields, never an issuer-based asset', () => {
  const asset = token();
  assert.equal(asset.kind, 'contract'); assert.equal(asset.code, 'HAHA'); assert.equal(asset.name, 'HahaToken');
  assert.equal(asset.address, haha); assert.equal(asset.assetCode, null); assert.equal(asset.issuer, undefined);
  assert.equal(asset.decimals, 7); assert.equal(asset.id, 'mainnet:contract:' + haha);
  assert.ok(SPOT_INDEXED_ASSETS.some(asset => asset.address === haha));
  assert.equal(SPOT_INDEXED_ASSETS.length, require('../components/spot-indexed-tokens.json').tokens.length);
  assert.equal(new Set(SPOT_INDEXED_ASSETS.map(asset => asset.id)).size, SPOT_INDEXED_ASSETS.length);
  assert.throws(() => m.bluxAsset(asset), /Soroban route/);
});
test('local indexed tokens match case-insensitive full/partial address, symbol, name and assetCode', () => {
  const asset = token({ assetCode: 'ALIAS' });
  for (const query of [haha, haha.toLowerCase(), haha.slice(5, 25), haha.slice(0, 30).toLowerCase(), 'HAHA', 'haha', 'hAhAtOkEn', 'token', 'aLiAs']) {
    assert.equal(spotAssetMatches(asset, query), true, query);
  }
  for (const query of ['unrelated', 'null', 'undefined']) assert.equal(spotAssetMatches(token(), query), false);
  const native = m.spotAsset('XLM', undefined, 'mainnet');
  assert.equal(spotAssetMatches(native, Asset.native().contractId(Networks.PUBLIC).slice(0, 30).toLowerCase()), true);
});
test('nullable metadata uses symbol then assetCode then address without assigning verified branding', () => {
  assert.equal(token({ symbol: null, assetCode: 'FALLBACK', name: null }).code, 'FALLBACK');
  assert.equal(token({ symbol: '', assetCode: 'FALLBACK' }).code, 'FALLBACK');
  const fallback = token({ symbol: null, assetCode: null, name: null });
  assert.ok(fallback.code.includes(haha.slice(0, 6))); assert.equal(fallback.name, fallback.code);
  const spoof = token({ symbol: 'USDC', name: 'USD Coin' });
  assert.equal(spoof.icon, undefined); assert.notEqual(spoof.curated, true);
  for (const invalid of [null, {}, record({ address: 'CBAD' }), record({ decimals: null }), record({ decimals: 39 }), record({ decimals: -1 }), record({ decimals: 7.5 })]) {
    assert.equal(spotIndexedAsset(invalid), undefined);
  }
  const asset = new Asset('usdc', Keypair.random().publicKey());
  const classic = { address: asset.contractId(Networks.PUBLIC), name: null, symbol: null, decimals: 7, issuer: asset.issuer, assetCode: asset.code, type: 'classic' };
  assert.equal(spotIndexedAsset(classic, 'mainnet').code, 'usdc');
  assert.equal(spotIndexedAsset({ ...classic, address: haha }, 'mainnet'), undefined);
  assert.equal(spotIndexedAsset(classic, 'testnet'), undefined);
});
test('known indexed addresses resolve immediately without any RPC, even when RPC is unavailable', async t => {
  mockFetch(t, () => { assert.fail('Indexed metadata must not require RPC verification.'); });
  const asset = await resolveSpotToken(haha.toLowerCase(), 'mainnet');
  assert.equal(asset.kind, 'contract'); assert.equal(asset.code, 'HAHA');
});
test('unindexed SAC lookup still preserves the original native/classic identity without SEP-41 probes', async t => {
  const asset = new Asset('SAC', Keypair.random().publicKey()), fixture = spotSacFixture(asset, Networks.PUBLIC);
  let reads = 0;
  mockFetch(t, (_url, body) => {
    reads++; assert.equal(body.method, 'getLedgerEntries');
    return Response.json({ result: { entries: [{ key: body.params.keys[0], xdr: fixture.xdr }] } });
  });
  const found = await resolveSpotToken(fixture.address, 'mainnet', undefined, []);
  assert.equal(found.kind, 'classic'); assert.equal(found.issuer, asset.issuer); assert.equal(reads, 1);
});
test('unindexed WASM tokens fall back to read-only SEP-41 name, symbol and decimals simulation', async t => {
  const fixture = spotSacFixture(Asset.native(), Networks.PUBLIC, { wasm: true, address: unknown });
  const methods = [];
  mockFetch(t, (_url, body, options) => {
    assert.equal(options.cache, 'no-store'); methods.push(body.method);
    if (body.method === 'getLedgerEntries') return Response.json({ result: { entries: [{ key: body.params.keys[0], xdr: fixture.xdr }] } });
    assert.equal(body.method, 'simulateTransaction');
    const call = simulatedMethod(body), method = call.functionName.toString();
    assert.equal(Address.fromScAddress(call.contractAddress).toString(), unknown);
    assert.equal(call.args.length, 0); methods.push(method);
    return Response.json({ result: { results: [{ xdr: encoded({ name: 'Nine decimal token', symbol: 'NINE', decimals: 9 }[method]) }] } });
  });
  const found = await resolveSpotToken(unknown, 'mainnet');
  assert.equal(found.kind, 'contract'); assert.equal(found.code, 'NINE'); assert.equal(found.decimals, 9);
  assert.equal(found.address, unknown); assert.equal(found.issuer, undefined); assert.equal(found.icon, undefined);
  assert.equal(methods[0], 'getLedgerEntries');
  assert.deepEqual(methods.filter(method => ['name', 'symbol', 'decimals'].includes(method)).sort(), ['decimals', 'name', 'symbol']);
});
test('missing contracts report failure only after both SAC and SEP-41 lookup fail', async t => {
  const methods = [];
  mockFetch(t, (_url, body) => {
    methods.push(body.method);
    return Response.json(body.method === 'getLedgerEntries' ? { result: { entries: [] } } : { result: { error: 'HostError: MissingValue' } });
  });
  await assert.rejects(resolveSpotToken(unknown, 'mainnet'), /Stellar asset contract or SEP-41 token/);
  assert.equal(methods[0], 'getLedgerEntries'); assert.equal(methods.filter(method => method === 'simulateTransaction').length, 3);
  await assert.rejects(resolveSpotToken('CBAD', 'mainnet'), /valid Stellar contract address/);
});
test('malformed metadata and unsupported decimals never create a token from an unknown contract', async t => {
  let decimals = 39;
  mockFetch(t, (_url, body) => {
    if (body.method === 'getLedgerEntries') return Response.json({ result: { entries: [] } });
    const method = simulatedMethod(body).functionName.toString();
    return Response.json({ result: { results: [{ xdr: encoded(method === 'decimals' ? decimals : method === 'name' ? 'Token' : 'TKN') }] } });
  });
  await assert.rejects(resolveSpotToken(unknown, 'mainnet'), /SEP-41 token/);
  decimals = 9;
  assert.equal((await resolveSpotToken(unknown, 'mainnet')).decimals, 9);
});
test('SEP-41 balance reads retain i128 units and the selected contract/owner without signing', async t => {
  const owner = Keypair.random().publicKey(), expected = 900719925474099312345n;
  mockFetch(t, (_url, body) => {
    assert.equal(body.method, 'simulateTransaction');
    const call = simulatedMethod(body);
    assert.equal(call.functionName.toString(), 'balance');
    assert.equal(Address.fromScAddress(call.contractAddress).toString(), haha);
    assert.equal(Address.fromScVal(call.args[0]).toString(), owner);
    return Response.json({ result: { results: [{ xdr: encoded(expected) }] } });
  });
  assert.equal(await readSpotContractBalance(token(), owner), expected);
});
test('contract precision, formatting and limits use token decimals and i128, not classic stroops', () => {
  for (const decimals of [0, 2, 7, 9, 18, 38]) {
    const asset = token({ decimals });
    const value = m.spotDecimal(m.SPOT_MAX_CONTRACT_AMOUNT, decimals);
    assert.equal(m.parseSpotAssetAmount(value, asset), m.SPOT_MAX_CONTRACT_AMOUNT);
    assert.throws(() => m.parseSpotAssetAmount(m.spotDecimal(m.SPOT_MAX_CONTRACT_AMOUNT + 1n, decimals), asset));
  }
  const nine = token({ decimals: 9 });
  assert.equal(m.parseSpotAssetAmount('0.000000001', nine), 1n);
  assert.equal(m.minimumReceived('0.000000001', 30, 9), '0.000000001');
  assert.equal(m.formatSpotQuoteAmount('0.000000001', 7, 9), '0.000000001');
  assert.equal(m.formatSpotAmount(1234567891n, 9), '1.23');
  assert.equal(m.spotRate('2.5', '10', 9, 18), '0.25');
  assert.throws(() => m.parseSpotAssetAmount('0.0000000001', nine));
});
test('contract balances do not create classic receiving trustlines or bypass reserve checks', () => {
  const owner = Keypair.random().publicKey(), asset = token({ decimals: 9 }), native = m.spotAsset('XLM', undefined, 'mainnet');
  const account = { account_id: owner, subentry_count: 0, balances: [{ asset_type: 'native', balance: '20' }], contractBalances: { [haha]: 1234567891n } };
  const incoming = { request: { from: native, to: asset, amount: '10', account: owner }, output: '1.234567891' };
  assert.deepEqual(m.trustlineChange(account, asset), { operations: 1, newEntries: 0 });
  assert.equal(sorobanSpotValidation(account, incoming, 5000000n), undefined);
  const outgoing = { request: { from: asset, to: native, amount: '1.234567891', account: owner }, output: '10' };
  assert.equal(m.availableAsset(account, asset), 1234567891n);
  assert.equal(sorobanSpotValidation(account, outgoing, 5000000n), undefined);
  assert.match(sorobanSpotValidation({ ...account, contractBalances: {} }, outgoing, 5000000n), /balance is unavailable/);
  assert.match(sorobanSpotValidation(account, { ...outgoing, request: { ...outgoing.request, amount: '1.234567892' } }, 5000000n), /Insufficient/);
  assert.match(sorobanSpotValidation({ ...account, balances: [{ asset_type: 'native', balance: '1' }] }, outgoing, 5000000n), /1 XLM/);
});
