require('@next/env').loadEnvConfig(process.cwd());
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, Memo } = require('@stellar/stellar-sdk');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const m = require('../components/spot-utils.ts');
const executionPath = require.resolve('../components/spot-execution.ts');
const executionModule = new Module(executionPath, module);
executionModule.filename = executionPath;
executionModule.paths = Module._nodeModulePaths(path.dirname(executionPath));
const executionRequire = executionModule.require.bind(executionModule);
executionModule.require = id => id === '@bluxcc/react' ? { StellarSdk: require('@stellar/stellar-sdk') } : executionRequire(id);
executionModule._compile(ts.transpileModule(fs.readFileSync(executionPath, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, executionPath);
const { buildNativeSpotEnvelope, verifySpotSignature } = executionModule.exports;
const { inspectSpotEnvelope, spotEnvelopeHash, verifySignedSpotEnvelope } = require('../components/spot-utils.ts');
const trader = Keypair.random(); const stranger = Keypair.random();
const to = m.spotAsset('USDC', m.CIRCLE_TESTNET_USDC);
const sdkTo = new Asset(to.code, to.issuer);
const account = { account_id: trader.publicKey(), subentry_count: 0, balances: [{ asset_type: 'native', balance: '100' }] };
const quote = { request: { from: m.spotAsset('XLM'), to, amount: '10', account: trader.publicKey() }, output: '9.5' };
const reserve = m.parseSpotAmount('0.5');
function build({ minimum = '9.4715', amount = '10', destination = trader.publicKey(), send = Asset.native(), receive = sdkTo,
  extra, trust = true, fee, memo, source = trader.publicKey(), expires = true, network = Networks.TESTNET } = {}) {
  const ops = trust ? [Operation.changeTrust({ asset: receive })] : [];
  ops.push(Operation.pathPaymentStrictSend({ sendAsset: send, sendAmount: amount, destination, destAsset: receive, destMin: minimum, path: [] }));
  if (extra) ops.push(extra);
  const builder = new TransactionBuilder(new Account(source, '1'), { networkPassphrase: network, fee: fee ?? '100000' });
  ops.forEach(op => builder.addOperation(op)); if (memo) builder.addMemo(memo);
  return builder.setTimeout(expires ? 180 : 0).build();
}
test('the final Blux envelope can add one receiving trustline and keeps the reviewed minimum, identity, fee and source', () => {
  const tx = build(); const checked = inspectSpotEnvelope(tx.toXDR(), quote, 30, account, reserve);
  assert.equal(checked.minimum, '9.4715000'); assert.equal(checked.fee, 200000n);
  assert.equal(checked.hash, Buffer.from(tx.hash()).toString('hex')); assert.ok(checked.expiresAt > Date.now());
  tx.sign(trader); assert.equal(spotEnvelopeHash(tx.toXDR()), checked.hash);
});
test('a re-quote may improve protection but cannot weaken it even by a single stroop', () => {
  assert.doesNotThrow(() => inspectSpotEnvelope(build({ minimum: '9.6' }).toXDR(), quote, 30, account, reserve));
  assert.throws(() => inspectSpotEnvelope(build({ minimum: '9.4714999' }).toXDR(), quote, 30, account, reserve), /weaken/);
});
test('a native envelope cannot substitute a different selected path even with a stronger minimum', () => {
  const selected = { ...quote, route: [quote.request.from, m.spotAsset('OTHER', stranger.publicKey()), to] };
  assert.throws(() => inspectSpotEnvelope(build({ minimum: '9.6' }).toXDR(), selected, 30, account, reserve), /selected Stellar path changed/);
});

test('existing trustlines are reused and native receiving never adds a trustline', () => {
  const line = { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: to.issuer, balance: '20', limit: '1000', is_authorized: true };
  const existing = { ...account, subentry_count: 1, balances: [...account.balances, line] };
  const reused = inspectSpotEnvelope(build({ trust: false }).toXDR(), quote, 30, existing, reserve);
  assert.equal(reused.fee, 100000n);
  assert.throws(() => inspectSpotEnvelope(build().toXDR(), quote, 30, existing, reserve));
  const sellQuote = { ...quote, request: { ...quote.request, from: to, to: m.spotAsset('XLM') } };
  const native = build({ send: sdkTo, receive: Asset.native(), trust: false });
  assert.equal(inspectSpotEnvelope(native.toXDR(), sellQuote, 30, existing, reserve).fee, 100000n);
  const limited = { ...existing, balances: [account.balances[0], { ...line, limit: '21' }] };
  assert.equal(m.trustlineChange(limited, to, quote.output).newEntries, 0);
  assert.doesNotThrow(() => inspectSpotEnvelope(build().toXDR(), quote, 30, limited, reserve));
});

test('a missing receiving trustline must be created before the path payment', () => {
  assert.throws(() => inspectSpotEnvelope(build({ trust: false }).toXDR(), quote, 30, account, reserve), /trustline must be established before/);
  const path = Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: '10', destination: trader.publicKey(), destAsset: sdkTo, destMin: '9.4715', path: [] });
  const reversed = new TransactionBuilder(new Account(trader.publicKey(), '1'), { networkPassphrase: Networks.TESTNET, fee: '100000' })
    .addOperation(path).addOperation(Operation.changeTrust({ asset: sdkTo })).setTimeout(180).build();
  assert.throws(() => inspectSpotEnvelope(reversed.toXDR(), quote, 30, account, reserve), /trustline must be established before/);
});
test('changed amounts, assets, recipients, extra operations, memo and fee are blocked before wallet signing', () => {
  for (const opts of [{ amount: '11' }, { destination: stranger.publicKey() }, { source: stranger.publicKey() },
    { send: new Asset('OTHER', stranger.publicKey()) }, { receive: new Asset('USDC', stranger.publicKey()) },
    { extra: Operation.payment({ destination: stranger.publicKey(), asset: Asset.native(), amount: '1' }) },
    { memo: Memo.text('changed') }, { fee: '100001' }, { expires: false }]) assert.throws(() => inspectSpotEnvelope(build(opts).toXDR(), quote, 30, account, reserve));
});
test('guard rechecks the native reserve immediately before signing and detects mutated signed bodies', () => {
  assert.throws(() => inspectSpotEnvelope(build().toXDR(), quote, 30, { ...account, balances: [{ asset_type: 'native', balance: '11.51' }] }, reserve), /reserve and fee/);
  assert.notEqual(spotEnvelopeHash(build({ amount: '11' }).toXDR()), spotEnvelopeHash(build().toXDR()));
});
test('submission rejects a wallet-mutated body or a transaction that expired during approval', () => {
  const tx = build(); const checked = inspectSpotEnvelope(tx.toXDR(), quote, 30, account, reserve); tx.sign(trader);
  assert.doesNotThrow(() => verifySignedSpotEnvelope(tx.toXDR(), checked, checked.expiresAt - 1));
  assert.throws(() => verifySignedSpotEnvelope(tx.toXDR(), checked, checked.expiresAt), /expired while waiting/);
  const changed = build({ amount: '11' }); changed.sign(trader);
  assert.throws(() => verifySignedSpotEnvelope(changed.toXDR(), checked, checked.expiresAt - 1), /wallet changed/);
});
test('same XDR signed for Mainnet cannot produce a valid Testnet signature', () => {
  const tx = build({ network: Networks.PUBLIC }); tx.sign(trader);
  const asTestnet = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
  assert.equal(trader.verify(asTestnet.hash(), tx.signatures[0].signature), false);
});
test('native construction preserves the selected path, reviewed minimum and receiving trustline', () => {
  const bridge = m.spotAsset('OTHER', stranger.publicKey());
  const selected = { ...quote, route: [quote.request.from, bridge, to] };
  const records = [{ source_asset_type: 'native', source_amount: '10', destination_asset_type: 'credit_alphanum4',
    destination_asset_code: to.code, destination_asset_issuer: to.issuer, destination_amount: '9.5',
    path: [{ asset_type: 'credit_alphanum4', asset_code: bridge.code, asset_issuer: bridge.issuer }] }];
  const xdr = buildNativeSpotEnvelope({ quote: selected, bps: 30 }, { ...account, sequence: '1' }, records);
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  assert.deepEqual(tx.operations.map(operation => operation.type), ['changeTrust', 'pathPaymentStrictSend']);
  assert.deepEqual(tx.operations[1].path.map(asset => asset.code), ['OTHER']);
  assert.equal(inspectSpotEnvelope(xdr, selected, 30, account, reserve).minimum, '9.4715000');
  assert.throws(() => buildNativeSpotEnvelope({ quote: selected, bps: 30 }, { ...account, sequence: '1' }, []), /no longer available/);
  assert.throws(() => buildNativeSpotEnvelope({ quote: selected, bps: 30 }, { ...account, sequence: '1' }, [{ ...records[0], destination_amount: '9.4' }]), /quote changed/);
});
test('signature validation rejects unsigned, wrong-account and wrong-network wallet responses', () => {
  const valid = build(); valid.sign(trader);
  assert.doesNotThrow(() => verifySpotSignature(valid.toXDR(), account, Networks.TESTNET));
  assert.throws(() => verifySpotSignature(build().toXDR(), account, Networks.TESTNET), /no valid signature/);
  const wrongAccount = build(); wrongAccount.sign(stranger);
  assert.throws(() => verifySpotSignature(wrongAccount.toXDR(), account, Networks.TESTNET), /no valid signature/);
  const wrongNetwork = build({ network: Networks.PUBLIC }); wrongNetwork.sign(trader);
  assert.throws(() => verifySpotSignature(wrongNetwork.toXDR(), account, Networks.TESTNET), /no valid signature/);
});
