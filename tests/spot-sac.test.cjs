require('@next/env').loadEnvConfig(process.cwd());
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { Asset, Contract, Keypair, Networks } = require('@stellar/stellar-sdk');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { spotAssetFromSacEntry, resolveSpotSac } = require('../components/spot-sac.ts');
const { spotNetwork } = require('../components/spot-network.ts');
const { spotSacFixture } = require('./helpers/spot-sac-fixture.cjs');
const issuer = Keypair.random().publicKey();

test('SAC resolution preserves case-sensitive code and issuer on each network, including native XLM', () => {
  for (const [network, passphrase] of [['mainnet', Networks.PUBLIC], ['testnet', Networks.TESTNET]]) {
    for (const asset of [Asset.native(), new Asset('usdc', issuer), new Asset('LONGERASSET', issuer)]) {
      const entry = spotSacFixture(asset, passphrase);
      const result = spotAssetFromSacEntry(entry.address, entry.xdr, network);
      assert.equal(result.network, network); assert.equal(result.code, asset.code);
      assert.equal(result.issuer, asset.isNative() ? undefined : issuer);
      assert.equal(result.kind, asset.isNative() ? 'native' : 'classic');
    }
  }
});
test('wrong network, forged asset identity, custom contract and mismatched entry cannot resolve as a SAC', () => {
  const asset = new Asset('TEST', issuer);
  const entry = spotSacFixture(asset, Networks.PUBLIC);
  assert.throws(() => spotAssetFromSacEntry(entry.address, entry.xdr, 'testnet'), /not a Stellar asset contract/);
  for (const options of [{ wasm: true }, { metadataAsset: Asset.native() }]) {
    const forged = spotSacFixture(asset, Networks.PUBLIC, options);
    assert.throws(() => spotAssetFromSacEntry(forged.address, forged.xdr, 'mainnet'), /not a Stellar asset contract/);
  }
  assert.throws(() => spotAssetFromSacEntry(Asset.native().contractId(Networks.PUBLIC), entry.xdr, 'mainnet'), /not a Stellar asset contract/);
});
test('RPC lookup uses the requested network and exact ledger key; failures stay actionable', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const asset = new Asset('TEST', issuer);
  for (const network of ['mainnet', 'testnet']) {
    const entry = spotSacFixture(asset, spotNetwork(network).passphrase);
    const key = new Contract(entry.address).getFootprint().toXDR('base64');
    global.fetch = async (url, options) => {
      assert.equal(url, spotNetwork(network).sorobanRpcUrl);
      assert.equal(options.cache, 'no-store');
      assert.deepEqual(JSON.parse(options.body).params.keys, [key]);
      return Response.json({ result: { entries: [{ key, xdr: entry.xdr }] } });
    };
    assert.equal((await resolveSpotSac(entry.address, network)).issuer, issuer);
    global.fetch = async () => Response.json({ result: { entries: [] } });
    await assert.rejects(resolveSpotSac(entry.address, network), /No active Stellar asset contract/);
    global.fetch = async () => Response.json({ error: { message: 'Internal details' } });
    await assert.rejects(resolveSpotSac(entry.address, network), /Retry shortly/);
  }
  await assert.rejects(resolveSpotSac('CBAD'), /valid Stellar contract address/);
});
