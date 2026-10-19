/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const sdk = require('@stellar/stellar-sdk');

const issuer = sdk.Keypair.random().publicKey();
function fixture(network, overrides = {}) {
  const mainnet = network === 'mainnet';
  const env = {
    NEXT_PUBLIC_BLUX_APP_ID: 'network-test',
    NEXT_PUBLIC_STELLAR_NETWORK: network,
    NEXT_PUBLIC_STELLAR_HORIZON_URL: `https://${mainnet ? 'mainnet' : 'testnet'}-horizon.example`,
    NEXT_PUBLIC_STELLAR_RPC_URL: `https://${mainnet ? 'mainnet' : 'testnet'}-rpc.example`,
    NEXT_PUBLIC_STELLAR_EXPLORER_URL: `https://stellar.expert/explorer/${mainnet ? 'public' : 'testnet'}`,
    NEXT_PUBLIC_STELLAR_USDC_ISSUER: issuer,
    NEXT_PUBLIC_STELLAR_USDC_SAC_ADDRESS: new sdk.Asset('USDC', issuer).contractId(mainnet ? sdk.Networks.PUBLIC : sdk.Networks.TESTNET),
    NEXT_PUBLIC_PERPETUALS_PAYMENT_DESTINATION: issuer,
    ...overrides,
  };
  const cache = new Map();
  let fetcher = () => { throw new Error('Unexpected network request'); };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const moduleRecord = { exports: {} };
    cache.set(filename, moduleRecord);
    const localRequire = createRequire(filename);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      module: moduleRecord, exports: moduleRecord.exports, process: { env }, URL, AbortSignal,
      fetch: (...args) => fetcher(...args),
      require: id => id === '@bluxcc/react' ? { StellarSdk: sdk }
        : id.startsWith('.') && !id.endsWith('.json') ? load(path.resolve(path.dirname(filename), id + '.ts')) : localRequire(id),
    }, { filename });
    return moduleRecord.exports;
  }
  return {
    load: name => load(path.resolve(__dirname, '../components', name + '.ts')),
    fetch: fn => { fetcher = fn; },
  };
}

for (const network of ['testnet', 'mainnet']) {
  test(`${network} uses configured URLs and passphrase without contaminating the alternate network`, async () => {
    const f = fixture(network, { NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL: 'https://alternate-mainnet-rpc.example' });
    const config = f.load('runtime-config').LUMIX_PUBLIC_CONFIG.stellar;
    const spot = f.load('spot-network');
    const selected = spot.spotNetwork();
    assert.equal(config.id, network);
    assert.equal(spot.SPOT_DEFAULT_NETWORK, network);
    assert.equal(selected.passphrase, network === 'mainnet' ? sdk.Networks.PUBLIC : sdk.Networks.TESTNET);
    assert.equal(selected.horizonUrl, `https://${network}-horizon.example`);
    assert.equal(selected.sorobanRpcUrl, `https://${network}-rpc.example`);
    assert.equal(selected.explorerBaseUrl, `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}`);
    const alternate = spot.spotNetwork(network === 'mainnet' ? 'testnet' : 'mainnet');
    assert.equal(alternate.horizonUrl, network === 'mainnet' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    assert.equal(alternate.sorobanRpcUrl, network === 'mainnet' ? 'https://soroban-testnet.stellar.org' : 'https://alternate-mainnet-rpc.example');
    const utils = f.load('spot-utils');
    f.fetch(async url => ({ ok: true, json: async () => ({ network_passphrase: url.startsWith(selected.horizonUrl) ? selected.passphrase : alternate.passphrase }) }));
    await utils.verifySpotNetwork(network);
    await utils.verifySpotNetwork(network === 'mainnet' ? 'testnet' : 'mainnet');
    const hash = 'a'.repeat(64);
    assert.equal(utils.spotTransactionUrl(hash, network), `${selected.explorerBaseUrl}/tx/${hash}`);
    f.fetch(async () => ({ ok: true, json: async () => ({ network_passphrase: alternate.passphrase }) }));
    await assert.rejects(utils.verifySpotNetwork(network), /configured Horizon endpoint is not Stellar/);
  });
}

test('missing network preserves Testnet and invalid network names fail configuration', () => {
  assert.equal(fixture(undefined).load('spot-network').SPOT_DEFAULT_NETWORK, 'testnet');
  assert.throws(() => fixture('pubnet').load('runtime-config'), /NEXT_PUBLIC_STELLAR_NETWORK must be mainnet or testnet/);
});

test('Mainnet cannot send a Perpetuals Testnet demo payment', async () => {
  const payment = fixture('mainnet').load('stellar-testnet-payment');
  await assert.rejects(payment.preparePerpetualsTestnetPayment(issuer, '1'), /only on Stellar Testnet/);
});
