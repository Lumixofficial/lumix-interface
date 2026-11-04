const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { Keypair } = require('@stellar/stellar-sdk');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { readSavedWallet, saveWallet, clearSavedWallet } = require('../components/wallet-session.ts');
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('wallet type and public key survive reload and explicit logout clears both storage formats', () => {
  const store = storage(), address = Keypair.random().publicKey();
  saveWallet(address, store);
  assert.equal(store.getItem('lumix_wallet_type'), 'blux');
  assert.equal(store.getItem('lumix_wallet_address'), address);
  assert.deepEqual(readSavedWallet(store), { type: 'blux', address });
  clearSavedWallet(store);
  assert.equal(readSavedWallet(store), undefined);
  assert.equal(store.getItem('lumix_wallet_connected'), null);
});

test('legacy connection markers are recognized, but incomplete or invalid saved addresses cannot restore', () => {
  const store = storage(), address = Keypair.random().publicKey();
  store.setItem('lumix_wallet_connected', 'blux');
  assert.equal(readSavedWallet(store), undefined);
  store.setItem('lumix_wallet_address', 'not-a-public-key');
  assert.equal(readSavedWallet(store), undefined);
  store.setItem('lumix_wallet_address', address);
  assert.equal(readSavedWallet(store).address, address);
  store.setItem('lumix_wallet_type', 'other-wallet');
  assert.equal(readSavedWallet(store), undefined);
});

test('SSR and blocked browser storage never prevent wallet initialization or logout', () => {
  assert.equal(readSavedWallet(), undefined);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(readSavedWallet(blocked), undefined);
  assert.doesNotThrow(() => saveWallet(Keypair.random().publicKey(), blocked));
  assert.doesNotThrow(() => clearSavedWallet(blocked));
});
