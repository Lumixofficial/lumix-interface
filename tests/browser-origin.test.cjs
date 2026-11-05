const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserTestOrigin } = require('./helpers/browser-origin.cjs');

test('browser harnesses accept any configured HTTP(S) origin without assuming an app port', t => {
  const original = process.env.LUMIX_TEST_ORIGIN;
  t.after(() => { if (original === undefined) delete process.env.LUMIX_TEST_ORIGIN; else process.env.LUMIX_TEST_ORIGIN = original; });
  process.env.LUMIX_TEST_ORIGIN = 'https://app.lumixmarket.com';
  assert.equal(browserTestOrigin(), 'https://app.lumixmarket.com');
  for (const port of [3001, 3002, 41837]) assert.equal(browserTestOrigin(`http://localhost:${port}/spot`), `http://localhost:${port}`);
  assert.equal(browserTestOrigin('https://staging.example'), 'https://staging.example');
  assert.throws(() => browserTestOrigin('file:///private'));
  assert.throws(() => browserTestOrigin('https://user:password@example.com'));
});

test('browser harnesses use PORT only when no origin is configured, and reject missing configuration', t => {
  for (const name of ['LUMIX_TEST_ORIGIN', 'PORT']) {
    const original = process.env[name];
    t.after(() => { if (original === undefined) delete process.env[name]; else process.env[name] = original; });
    delete process.env[name];
  }
  assert.throws(() => browserTestOrigin(), /Set LUMIX_TEST_ORIGIN/);
  process.env.PORT = '41837';
  assert.equal(browserTestOrigin(), 'http://localhost:41837');
  for (const port of ['0', '-1', '70000', 'invalid']) {
    process.env.PORT = port;
    assert.throws(() => browserTestOrigin());
  }
});
