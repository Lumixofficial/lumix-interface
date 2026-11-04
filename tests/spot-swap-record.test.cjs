const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { recordSpotSwap, spotSwapRecordPayload } = require('../components/spot-swap-record.ts');
const { spotApiFixture, issuer } = require('./helpers/spot-api-fixture.cjs');
const hash = 'a'.repeat(64);
const sender = issuer;
const from = { id: 'mainnet:native', network: 'mainnet', kind: 'native', code: 'XLM' };
const to = { id: `mainnet:classic:USDC:${issuer}`, network: 'mainnet', kind: 'classic', code: 'USDC', issuer };
const native = { source: 'native', request: { account: sender, from, to, amount: '100' }, route: [from, to] };
const payload = { txHash: hash, sender, venue: 'STELLAR_NATIVE' };

test('native attribution preserves the submitted hash, reviewed sender and full asset identities', () => {
  const value = spotSwapRecordPayload(hash, native);
  assert.equal(value.txHash, hash);
  assert.equal(value.sender, sender);
  assert.equal(value.venue, 'STELLAR_NATIVE');
  assert.equal(value.route.path[1].issuer, issuer);
  assert.equal(value.route.path[0].code, 'XLM');
});

test('aggregator attribution retains split legs and protocol metadata without signing arguments', () => {
  const soroban = spotApiFixture(sender).data[0];
  const value = spotSwapRecordPayload(hash, { ...native, source: 'soroban', soroban });
  assert.equal(value.venue, 'CONTRACT_AGGREGATOR');
  assert.equal(value.route.type, soroban.type);
  assert.deepEqual(value.route.legs, soroban.legs);
  assert.equal(value.route.txData, undefined);
  assert.doesNotThrow(() => JSON.stringify(value));
});

test('Testnet swaps, public previews and invalid hashes never produce attribution', () => {
  for (const quote of [
    { ...native, request: { ...native.request, from: { ...from, network: 'testnet' } } },
    { ...native, request: { ...native.request, to: { ...to, network: 'testnet' } } },
    { ...native, request: { ...native.request, account: undefined } },
  ]) assert.equal(spotSwapRecordPayload(hash, quote), undefined);
  for (const invalid of ['', 'signed-not-submitted', 'g'.repeat(64), 'a'.repeat(63)]) {
    assert.equal(spotSwapRecordPayload(invalid, native), undefined);
  }
});

function restoreApiUrl(t) {
  const original = process.env.NEXT_PUBLIC_API_URL;
  t.after(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = original;
  });
}

test('the default endpoint accepts an empty 202 response and sends only JSON attribution', async t => {
  restoreApiUrl(t);
  delete process.env.NEXT_PUBLIC_API_URL;
  const log = t.mock.method(console, 'log', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }));
  await recordSpotSwap(payload);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'http://localhost:8080/v1/spot/swaps/record');
  assert.equal(options.method, 'POST');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(options.body), { ...payload, route: {} });
  assert.equal(options.credentials, 'omit');
  assert.equal(options.keepalive, true);
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    [`[Swap Attribution] Reporting STELLAR_NATIVE swap ${hash} to API...`],
    ['[Swap Attribution] Response:', 202],
  ]);
  assert.equal(error.mock.callCount(), 0);
});

test('configured API base URLs preserve their path without duplicate slashes', async t => {
  restoreApiUrl(t);
  process.env.NEXT_PUBLIC_API_URL = ' https://api.example/base/// ';
  t.mock.method(console, 'log', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }));
  await recordSpotSwap({ ...payload, route: { path: ['XLM', 'USDC'] } });
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://api.example/base/v1/spot/swaps/record');
  assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body).route, { path: ['XLM', 'USDC'] });
});

test('HTTP failures and network exceptions resolve without leaking wallet data to logs', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.doesNotReject(recordSpotSwap(payload));
  fetch.mock.mockImplementation(async () => { throw new Error('network failed'); });
  await assert.doesNotReject(recordSpotSwap(payload));
  assert.deepEqual(error.mock.calls.map(call => call.arguments), [
    ['[Swap Attribution] Error:', 'Expected 202 Accepted; received HTTP 503.'],
    ['[Swap Attribution] Error:', 'network failed'],
  ]);
  assert.deepEqual(log.mock.calls.filter(call => call.arguments[0] === '[Swap Attribution] Response:').map(call => call.arguments), [
    ['[Swap Attribution] Response:', 503],
  ]);
  assert.ok([...log.mock.calls, ...error.mock.calls].every(call => !JSON.stringify(call.arguments).includes(sender)));
});

test('serialization errors cannot escape into transaction UI', async t => {
  t.mock.method(console, 'log', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }));
  const route = {}; route.self = route;
  await assert.doesNotReject(recordSpotSwap({ ...payload, route }));
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 1);
  assert.equal(error.mock.calls[0].arguments[0], '[Swap Attribution] Error:');
});
