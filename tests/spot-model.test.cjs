require('@next/env').loadEnvConfig(process.cwd());
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { Keypair } = require('@stellar/stellar-sdk');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const m = require('../components/spot-utils.ts');
const verified = require('../components/spot-verified-assets.json');
const tokenImages = require('../components/spot-token-images.json');
const issuer = Keypair.random().publicKey();
const address = Keypair.random().publicKey();
const native = m.spotAsset('XLM');
const usdc = m.spotAsset('USDC', m.CIRCLE_TESTNET_USDC);
const other = m.spotAsset('USDC', issuer);
const units = m.parseSpotAmount;
const account = overrides => ({ account_id: address, subentry_count: 1, num_sponsoring: 0, num_sponsored: 0, balances: [
  { asset_type: 'native', balance: '10', selling_liabilities: '1' },
  { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: usdc.issuer, balance: '20', limit: '50', selling_liabilities: '3', buying_liabilities: '5', is_authorized: true },
], ...overrides });
const request = overrides => ({ from: native, to: usdc, amount: '1', account: address, ...overrides });
const path = (amount, hops = [], overrides = {}) => ({ source_asset_type: 'native', source_amount: '1', destination_asset_type: 'credit_alphanum4',
  destination_asset_code: 'USDC', destination_asset_issuer: usdc.issuer, destination_amount: amount, path: hops, ...overrides });

test('asset identity binds network, case-sensitive code and checksum-valid issuer; branding never follows ticker alone', () => {
  assert.notEqual(native.id, m.spotAsset('XLM', issuer).id);
  assert.notEqual(usdc.id, other.id);
  assert.notEqual(other.id, m.spotAsset('usdc', issuer).id);
  assert.equal(usdc.icon, verified.circleTestnetUsdc.image);
  assert.equal(other.icon, undefined);
  assert.equal(m.spotAsset('usdc', usdc.issuer).icon, undefined);
  assert.throws(() => m.spotAsset('USDC'), /issuer/);
  assert.throws(() => m.spotAsset('USDC', issuer.slice(0, -1) + '0'), /valid full/);
  assert.throws(() => m.spotAsset('CONTRACT_ASSET', issuer), /classic/);
  const eurc = m.spotAsset('EURC', verified.circleTestnetEurc.issuer);
  assert.equal(eurc.icon, verified.circleTestnetEurc.image);
  assert.equal(eurc.curated, true);
  assert.equal(eurc.unavailableReason, undefined);
  assert.equal(m.spotAsset('EURC', issuer).icon, undefined);
  for (const asset of verified.mainnetOnly) {
    const blocked = m.spotAsset(asset.code, asset.issuer);
    assert.match(blocked.unavailableReason, /Mainnet/);
    assert.equal(blocked.curated, false);
    assert.ok(blocked.icon);
    assert.ok(!m.SPOT_CURATED_ASSETS.some(value => value.id === blocked.id));
    assert.match(m.spotValidation(account(), request({ to: blocked }), units('0.5')), /Mainnet/);
  }
});
test('30 local token artworks retain their exact network identities without extending the Testnet asset list', () => {
  const mainnet = Object.values(tokenImages.assets).filter(asset => asset.network === 'mainnet');
  const testnet = Object.values(tokenImages.assets).filter(asset => asset.network === 'testnet');
  assert.equal(mainnet.length + 1, 30);
  assert.equal(new Set([tokenImages.native.image, ...mainnet.map(asset => asset.image)]).size, 30);
  assert.equal(testnet.length, 2);
  assert.equal(m.SPOT_CURATED_ASSETS.length, 3);
  for (const [identity, asset] of Object.entries(tokenImages.assets)) {
    assert.equal(identity, `${asset.network}:classic:${asset.code}:${asset.issuer}`);
    assert.ok(require('@stellar/stellar-sdk').StrKey.isValidEd25519PublicKey(asset.issuer));
    assert.ok(fs.statSync('public' + asset.image).size > 0);
    assert.match(asset.source, /^https:\/\//); assert.match(asset.imageSource, /^https:\/\//);
    assert.equal(m.spotLocalTokenImage(asset.network, asset.code, asset.issuer), asset.image);
    assert.equal(m.spotLocalTokenImage(asset.network, asset.code, issuer), undefined);
    if (asset.network === 'mainnet') assert.equal(m.spotLocalTokenImage('testnet', asset.code, asset.issuer), undefined);
  }
  assert.equal(m.spotLocalTokenImage('testnet', 'XLM'), tokenImages.native.image);
  assert.equal(m.spotLocalTokenImage('testnet', 'XLM', issuer), undefined);
});
test('issuer metadata images match both code and full issuer and accept only usable HTTPS URLs', () => {
  const metadata = { CURRENCIES: [{ code: 'USDC', issuer: usdc.issuer, image: 'https://issuer.example/usdc.png' },
    { code: 'USDC', issuer, image: 'https://issuer.example/other.png' },
    { code: 'OTHER', issuer, image: 'https://issuer.example/other-code.png' }] };
  assert.equal(m.spotCurrencyImage(metadata, usdc), 'https://issuer.example/usdc.png');
  assert.equal(m.spotCurrencyImage(metadata, other), 'https://issuer.example/other.png');
  assert.equal(m.spotCurrencyImage(metadata, m.spotAsset('usdc', issuer)), undefined);
  assert.equal(m.spotCurrencyImage(metadata, m.spotAsset('EURC', issuer)), undefined);
  assert.equal(m.spotCurrencyImage(metadata, native), undefined);
  for (const image of ['http://issuer.example/icon.png', 'data:image/svg+xml,x', 'javascript:alert(1)', '/icon.png', 'https://user:secret@issuer.example/icon.png']) {
    assert.equal(m.spotCurrencyImage({ CURRENCIES: [{ code: other.code, issuer, image }] }, other), undefined);
  }
  for (const invalid of [undefined, 'bad TOML', {}, { CURRENCIES: {} }, { CURRENCIES: [null, 'invalid'] }]) assert.equal(m.spotCurrencyImage(invalid, other), undefined);
});
test('issuer home domains accept DNS names and reject malformed metadata locations', () => {
  assert.equal(m.spotHomeDomain(' Assets.Example.com '), 'assets.example.com');
  for (const domain of [undefined, '', 'https://example.com', 'example.com/path', 'user@example.com', 'localhost', '127.0.0.1', '-bad.example', 'a..example']) assert.equal(m.spotHomeDomain(domain), undefined);
});
test('seven-decimal amounts remain exact through Stellar maximum and reject invalid precision and notation', () => {
  for (const amount of ['0.0000001', '0.1234567', '9007199254.7409931', '922337203685.4775807']) assert.equal(m.spotDecimal(units(amount)), amount);
  assert.equal(m.formatSpotAmount('4700000.1234567'), '4,700,000.12');
  assert.equal(units('001.0000000'), 10000000n);
  assert.equal(units('.1'), 1000000n);
  assert.equal(units('1.'), 10000000n);
  for (const amount of ['', '.', '-1', '+1', '1e2', '1,000', '1.2.3', '1.12345678', '.12345678', 'NaN', 'Infinity', '922337203685.4775808']) assert.throws(() => units(amount));
});
test('slippage is a fraction for Blux, and the reviewed minimum rounds down only once to a stroop', () => {
  assert.equal(m.slippageFraction(30), .003);
  assert.equal(m.slippageFraction(50), .005);
  assert.equal(m.minimumReceived('123.4567891', 30), '123.0864187');
  assert.equal(m.minimumReceived('0.0000001', 500), '0.0000001');
  for (const bps of [0, .5, 501, NaN]) assert.throws(() => m.slippageFraction(bps));
  assert.equal(m.spotRate('10', '3'), '3.33');
});

test('display rounding uses two decimals without losing internal precision; tiny fees stay visible', () => {
  for (const [input, output] of [['1000', '1,000.00'], ['933.0481843', '933.05'], ['935.8557516', '935.86'], ['999.9999999', '1,000.00'], ['922337203685.4775807', '922,337,203,685.48']]) {
    assert.equal(m.formatSpotAmount(input), output);
    assert.equal(m.spotDecimal(units(input)), input);
  }
  assert.equal(m.formatSpotFee('0.00001'), '<0.01');
  assert.equal(m.formatSpotFee('0.0099999'), '<0.01');
  assert.equal(m.formatSpotFee('0'), '0.00');
  assert.equal(m.formatSpotFee('0.01'), '0.01');
});
test('quote displays preserve small positive minimums and never round the protected amount up', () => {
  assert.equal(m.formatSpotAmount(m.minimumReceived('0.001', 30)), '0.00');
  assert.equal(m.formatSpotQuoteAmount(m.minimumReceived('0.001', 30)), '0.000997');
  for (const [amount, expected] of [['0.0000001', '0.0000001'], ['0.0099999', '0.0099999'],
    ['101.694', '101.694'], ['99.705', '99.705'], ['1000.1', '1,000.10'], ['10', '10.00']]) {
    assert.equal(m.formatSpotQuoteAmount(amount), expected);
    assert.equal(units(expected.replaceAll(',', '')), units(amount));
  }
});

test('one asset search resolves code, known metadata name, full issuer and exact code:issuer identity', () => {
  assert.deepEqual(m.spotAssetSearch('EURC', [native, usdc]), { forCode: 'EURC' });
  assert.deepEqual(m.spotAssetSearch('USD Coin', [native, usdc]), { forCode: 'USDC' });
  assert.deepEqual(m.spotAssetSearch('usdc', [native, usdc]), { forCode: 'USDC' });
  assert.deepEqual(m.spotAssetSearch(issuer, [native, usdc]), { forIssuer: issuer });
  assert.deepEqual(m.spotAssetSearch('USDC:' + issuer, [native, usdc]), { forCode: 'USDC', forIssuer: issuer });
  for (const query of ['aqua', 'Aqua', 'AQUA']) assert.deepEqual(m.spotAssetSearch(query, [native, usdc]), { forCode: 'AQUA' });
  assert.deepEqual(m.spotAssetSearch('aQuA:' + issuer, [native, usdc]), { forCode: 'AQUA', forIssuer: issuer });
  assert.equal(m.spotAsset('aQuA', issuer).code, 'aQuA');
  assert.equal(m.spotAssetSearch(issuer.slice(0, -1), [native, usdc]), undefined);
});
test('every supported slippage setting keeps Blux binary-to-decimal rounding at least as protective as the review', () => {
  const BigNumber = require('bignumber.js'); const output = '922337203685.4775807';
  for (let bps = 1; bps <= 500; bps++) {
    const sdkMinimum = new BigNumber(units(output).toString()).times(1 - m.slippageFraction(bps)).integerValue(BigNumber.ROUND_FLOOR);
    assert.ok(BigInt(sdkMinimum.toFixed()) >= units(m.minimumReceived(output, bps)), `Weaker Blux minimum at ${bps} bps`);
  }
});
test('native quotes rank by output, retain alternative paths, and reject unrelated/empty routes', () => {
  const hop = { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer };
  const r = request();
  const short = path('1.1', [hop]);
  const best = path('2', [hop, hop]);
  assert.equal(m.chooseSpotPath([best, short, path('1.2')], r), best);
  const all = m.quotesFromPaths([best, short, path('1.2'), path('1.3'), path('9', [], { source_amount: '2' })], r);
  assert.deepEqual(all.map(quote => quote.output), ['2', '1.3', '1.1']);
  assert.equal(m.selectSpotPath([best, short, path('1.2')], all[2]), short);
  assert.throws(() => m.selectSpotPath([best], all[2]), /no longer available/);
  const indirect = m.quoteFromPaths([path('2', [hop, hop])], r);
  assert.equal(indirect.output, '2'); assert.equal(indirect.route.length, 4);
  assert.equal(m.quoteFromPaths([], r), null);
  assert.throws(() => m.quoteFromPaths([path('1', [], { destination_asset_issuer: issuer }), path('1', [], { source_amount: '2' })], r), /did not match/);
  assert.throws(() => m.quoteFromPaths([path('1', [{ asset_type: 'liquidity_pool_shares' }])], r), /did not match/);
});
test('quote keys isolate rapidly changed amounts, accounts and pair identities', () => {
  const old = m.quoteFromPaths([path('1')], request());
  for (const override of [{ amount: '2' }, { account: issuer }, { to: other }, { from: usdc, to: native }]) assert.notEqual(old.key, m.spotRequestKey(request(override)));
});
test('Max protects XLM reserves, selling liabilities and Blux fees including one automatic receiving trustline', () => {
  const reserve = units('.5'.replace('.', '0.'));
  assert.equal(m.spotRequirements(account(), native, usdc, reserve, '1').max, units('7.49'));
  const missing = m.spotRequirements(account(), native, other, reserve, '1');
  assert.equal(missing.operations, 2); assert.equal(missing.newEntries, 1); assert.equal(missing.max, units('6.98'));
  assert.match(m.spotValidation(account(), request({ to: other, amount: '7' }), reserve, '1'), /Keep enough XLM/);
  assert.equal(m.spotValidation(account(), request({ to: other, amount: '6.98' }), reserve, '1'), undefined);
  assert.equal(m.spotRequirements(account({ num_sponsored: 2 }), native, usdc, reserve).minimumBalance, units('0.5'));
  assert.equal(m.spotRequirements(account({ num_sponsored: 3 }), native, usdc, reserve).minimumBalance, 0n);
});
test('receiving capacity includes buying liabilities; authorization and source liabilities block unsafe swaps', () => {
  assert.equal(m.trustlineChange(account(), usdc, '25').operations, 1);
  assert.equal(m.trustlineChange(account(), usdc, '25.0000001').operations, 2);
  assert.equal(m.trustlineChange(account(), usdc, '25.0000001').newEntries, 0);
  const sell = request({ from: usdc, to: native, amount: '18' });
  assert.match(m.spotValidation(account(), sell, units('0.5'), '1'), /Insufficient available/);
  assert.equal(m.availableAsset(account(), usdc), units('17'));
  assert.equal(m.availableAsset(account(), other), 0n);
  assert.match(m.spotValidation(account(), request({ to: { ...other, authRequired: true } }), units('0.5'), '1'), /authorization/);
  const a = account(); a.balances[1].is_authorized = false;
  assert.match(m.spotValidation(a, request(), units('0.5'), '1'), /authorization/);
});
test('wallet cancellation is distinct from a confirmed or rejected Stellar submission and network failure', () => {
  assert.equal(m.walletRejected(new Error('The user rejected this request.')), true);
  assert.equal(m.walletRejected(new Error('Wallet approval cancelled.')), true);
  assert.equal(m.walletRejected(new Error('Network request failed.')), false);
  const error = { response: { data: { extras: { result_codes: { transaction: 'tx_insufficient_fee' } } } } };
  assert.equal(m.walletRejected(error), false);
  assert.match(m.spotError(error), /fee limit/);
  assert.match(m.spotError({ response: { data: { extras: { result_codes: { operations: ['op_under_dest_min'] } } } } }), /minimum received/);
  assert.match(m.spotError({ response: { data: { extras: { result_codes: { operations: ['op_line_full'] } } } } }), /trustline.*limit/);
  assert.match(m.spotError({ response: { data: { extras: { result_codes: { operations: ['op_not_authorized'] } } } } }), /issuer authorization/);
});
