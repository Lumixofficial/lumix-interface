const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { spotBackendUrl } = require('../app/api/spot/backend.ts');
const { POST } = require('../app/api/spot/swaps/record/route.ts');
const { issuer } = require('./helpers/spot-api-fixture.cjs');
const payload = { txHash: 'a'.repeat(64), sender: issuer, venue: 'STELLAR_NATIVE', route: { path: ['XLM', 'USDC'] } };
const request = (value = payload, origin = 'https://app.lumixmarket.com') => new Request(`${origin}/api/spot/swaps/record`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

function backendEnv(t, lumix, api) {
  for (const [name, value] of [['LUMIX_API_URL', lumix], ['API_URL', api]]) {
    const original = process.env[name];
    t.after(() => { if (original === undefined) delete process.env[name]; else process.env[name] = original; });
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}

test('server URL resolution uses LUMIX_API_URL, then API_URL, then the loopback backend default', t => {
  backendEnv(t, ' https://preferred.example/backend/// ', 'https://alternative.example');
  assert.equal(String(spotBackendUrl('/v1/spot/swaps/record')), 'https://preferred.example/backend/v1/spot/swaps/record');
  process.env.LUMIX_API_URL = ' ';
  assert.equal(String(spotBackendUrl('/v1/spot/quotes')), 'https://alternative.example/v1/spot/quotes');
  process.env.API_URL = '';
  assert.equal(String(spotBackendUrl('/v1/spot/swaps/record')), 'http://127.0.0.1:8080/v1/spot/swaps/record');
});

for (const origin of ['http://localhost:3001', 'http://localhost:3002', 'https://app.lumixmarket.com']) {
  for (const venue of ['STELLAR_NATIVE', 'CONTRACT_AGGREGATOR']) {
    test(`${venue} proxy forwards unchanged JSON from ${origin} and preserves an empty 202`, async t => {
      backendEnv(t, 'http://api:8080///');
      const body = { ...payload, venue };
      const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }));
      const result = await POST(request(body, origin));
      const [url, options] = fetch.mock.calls[0].arguments;
      assert.equal(String(url), 'http://api:8080/v1/spot/swaps/record');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), body);
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(result.status, 202);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(await result.text(), '');
      assert.equal(result.headers.has('access-control-allow-origin'), false);
    });
  }
}

test('proxy preserves upstream rejection status/body, but never forwards cookies or authorization', async t => {
  backendEnv(t, undefined, 'http://api:8080');
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Unavailable' }, {
    status: 503, headers: { 'Set-Cookie': 'private-fixture-cookie' },
  }));
  const incoming = request();
  incoming.headers.set('Authorization', 'Bearer private-fixture-token');
  incoming.headers.set('Cookie', 'private-fixture-cookie');
  const result = await POST(incoming);
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'Unavailable' });
  assert.equal(result.headers.has('set-cookie'), false);
  const headers = new Headers(fetch.mock.calls[0].arguments[1].headers);
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('cookie'), false);
});

test('invalid JSON, hashes, senders, venues and route shapes never reach the upstream', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  for (const value of [null, [], {}, { ...payload, txHash: 'invalid' }, { ...payload, sender: '' },
    { ...payload, venue: 'OTHER' }, { ...payload, route: [] }, { ...payload, route: null }]) {
    assert.equal((await POST(request(value))).status, 400);
  }
  assert.equal((await POST(new Request('http://app/api/spot/swaps/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});

test('non-JSON and oversized requests are rejected before proxying', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  assert.equal((await POST(new Request('http://app/api/spot/swaps/record', { method: 'POST', body: JSON.stringify(payload) }))).status, 415);
  assert.equal((await POST(request({ ...payload, route: { note: 'x'.repeat(32769) } }))).status, 413);
  const oversized = request(); oversized.headers.set('content-length', '32769');
  assert.equal((await POST(oversized)).status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});

test('connection failures and invalid backend configuration return sanitized errors', async t => {
  backendEnv(t, 'http://api:8080');
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream details'); });
  const failure = await POST(request());
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private upstream/);
  process.env.LUMIX_API_URL = 'file:///private-backend';
  assert.equal((await POST(request())).status, 503);
  assert.equal(fetch.mock.callCount(), 1);
});
