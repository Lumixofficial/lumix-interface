const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(
  fs.readFileSync(path, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, path);

const {
  createInitialMarketState,
  marketConfigs,
  recommendedStrike,
  submitOptionOrder,
  validateOptionStrike,
} = require('../components/options-market.ts');

test('recommended strikes come from the configured market strike ladder', () => {
  assert.equal(recommendedStrike(marketConfigs['XLM-USDC']), 0.25);
  assert.equal(recommendedStrike(marketConfigs['BTC-USDC']), 110000);
  assert.equal(recommendedStrike(marketConfigs['ETH-USDC']), 4300);
});

test('editable strikes respect the configured range and precision', () => {
  const xlm = marketConfigs['XLM-USDC'];
  assert.equal(validateOptionStrike(xlm, 0.2555), '');
  assert.match(validateOptionStrike(xlm, 0.17), /between 0.18 and 0.32 USDC/);
  assert.match(validateOptionStrike(xlm, 0.33), /between 0.18 and 0.32 USDC/);
  assert.match(validateOptionStrike(xlm, 0.25555), /up to 4 decimal places/);
  assert.match(validateOptionStrike(xlm, 0), /greater than zero/);
});

test('order submission rejects invalid strikes and retains valid custom strikes', t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-01T00:00:00Z'));
  const state = createInitialMarketState();
  const draft = {
    pairId: 'XLM-USDC',
    optionSide: 'call',
    orderSide: 'buy',
    strike: 0.25555,
    expirationId: '30-oct',
    limitPremium: 0.01,
    quantity: 1,
    orderExpiryId: '1h',
    intent: 'limit',
  };
  const invalid = submitOptionOrder(state, draft, { USDC: 1000, XLM: 1000 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /up to 4 decimal places/);

  const valid = submitOptionOrder(state, { ...draft, strike: 0.2555 }, { USDC: 1000, XLM: 1000 });
  assert.equal(valid.ok, true);
  assert.equal(valid.state.orders.find(order => order.id === valid.orderId).strike, 0.2555);
});
