/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS install script. */
// Blux 0.3.7 has no way to bind its final re-quote to a reviewed minimum.
// Keep its builder, wallet signing, and submission intact. Add optional guards
// before signing and submission; calls without these options are unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '../node_modules/@bluxcc/core');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.3.7') throw new Error('Review the Spot compatibility hook before using another Blux core version.');
const formats = [
  { file: 'index.esm.js', hash: '6b83fee9e7b40976a0d3c6dc51eb29dc4e36398f4d78310f3e34c7cab0dd5fe5', v1: '7e48e8892a7310bc38ae2a75efc2c03dadb3dc191108a647034226d4d35dae64', swap: 'P_', builder: 'U_', next: 'j_', network: 'MS', client: 'BE', signing: 'OA', signer: 'xA', submit: '_A', store: 'Ee', freighter: 'T' },
  { file: 'index.cjs.js', hash: 'cc91719cd31482d7dc3028598017b1354c17e2f766413be76f537e1a3c1b0544', v1: 'a6128eef0c5681d8f9659ca5db921eb4d3cb373cd221ec0b596502b10d997132', swap: 'i_', builder: 'r_', next: 'o_', network: 'tS', client: 'QA', signing: 'Hx', signer: '$x', submit: 'Kx', store: 'X', freighter: 'a.signTransaction' },
];
const oldMarker = '/* Lumix Spot guard v1: Blux 0.3.7 */';
const marker = '/* Lumix Spot guard v2: Blux 0.3.7 */';
for (const format of formats) {
  const file = path.join(root, 'dist', format.file);
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) continue;
  const digest = crypto.createHash('sha256').update(source).digest('hex');
  if (digest !== format.hash && digest !== format.v1) throw new Error(`Unexpected ${format.file}; refusing to patch an unknown Blux build.`);
  if (!source.includes(oldMarker)) {
  const start = source.indexOf(`${format.swap}=function(e)`);
  const end = source.indexOf(`,${format.next}=function`, start);
  if (start < 0 || end < 0 || end - start > 800) throw new Error('The expected Blux swap boundary was not found.');
  source = source.slice(0, start) + `${format.swap}=async function(e){const xdr=await ${format.builder}(e);if(e.lumixBeforeSign)await e.lumixBeforeSign(xdr);return ${format.client}.sendTransaction(xdr,{network:${format.network}(e.network).networkPassphrase,lumixBeforeSubmit:e.lumixBeforeSubmit})}` + source.slice(end);
  function replaceOnce(before, after) {
    if (source.split(before).length !== 2) throw new Error(`Unexpected Blux signing boundary in ${format.file}.`);
    source = source.replace(before, after);
  }
  replaceOnce(`${format.signing}=function(e,t,n,r,i,o)`, `${format.signing}=function(e,t,n,r,i,o,lumixBeforeSubmit)`);
  replaceOnce(`case 1:return a=s.sent(),o?[4,${format.submit}(a,r,i||{})]:[3,3];`,
    `case 1:return a=s.sent(),o?((lumixBeforeSubmit&&lumixBeforeSubmit(a)),[4,${format.submit}(a,r,i||{})]):[3,3];`);
  replaceOnce(`${format.signing}(s,e,o.user.address,a,o.config.transports||{},c.shouldSubmit)`,
    `${format.signing}(s,e,o.user.address,a,o.config.transports||{},c.shouldSubmit,c.options.lumixBeforeSubmit)`);
  replaceOnce(`${format.signing}(n,t.xdr,null===(i=e.user)||void 0===i?void 0:i.address,t.options.network,e.config.transports||{},t.shouldSubmit)`,
    `${format.signing}(n,t.xdr,null===(i=e.user)||void 0===i?void 0:i.address,t.options.network,e.config.transports||{},t.shouldSubmit,t.options.lumixBeforeSubmit)`);
  }
  // Use the existing Freighter request, but retain its explicit rejection/error.
  // This wrapper is used only for a Spot call that supplied the safety hook.
  const signStart = source.indexOf(`${format.signing}=function(e,t,n,r,i,o,lumixBeforeSubmit)`);
  const signEnd = source.indexOf(',Vx=', signStart) >= 0 ? source.indexOf(',Vx=', signStart) : source.indexOf(',NA=', signStart);
  if (signStart < 0 || signEnd < 0 || signEnd - signStart > 800) throw new Error('Unexpected guarded signing boundary.');
  source = source.slice(0, signStart) + `${format.signing}=async function(e,t,n,r,i,o,lumixBeforeSubmit){if(lumixBeforeSubmit&&e.name==="Freighter")e={...e,signTransaction:async function(xdr,opts){const response=await ${format.freighter}(xdr,{address:opts.address,networkPassphrase:opts.network});if(response.error)throw new Error(response.error.message||"Wallet signing failed.");if(!response.signedTxXdr)throw new Error("The wallet returned no signed transaction.");return response.signedTxXdr}};const signed=await ${format.signer}(e,t,n,r);if(o){if(lumixBeforeSubmit)await lumixBeforeSubmit(signed);return ${format.submit}(signed,r,i||{})}return signed}` + source.slice(signEnd);
  source = source.replace(oldMarker, '').replace(`${format.swap}.lumixSpotGuardVersion=1;`, '');
  // Read the actual wallet's network; Blux's exported walletPassphrase is only
  // recorded at login. This getter never switches networks or signs anything.
  source += `\n${marker}\n${format.swap}.lumixSpotGuardVersion=2;\n${format.swap}.lumixWalletNetwork=async function(){const state=${format.store}();if(!state.authState.isAuthenticated||!state.user)throw new Error("Wallet is disconnected.");if(state.user.authMethod!=="wallet")return state.stellar?.activeNetwork;const wallet=state.wallets.find(w=>w.name===state.user.authValue);if(!wallet?.getNetwork)throw new Error("Cannot verify the wallet network.");return (await wallet.getNetwork()).passphrase};\n`;
  fs.writeFileSync(file, source);
}
// The API supplies the aggregator call unchanged. Guard the SDK's simulated
// envelope too, and record its signed hash before a potentially ambiguous send.
const contractMarker = '/* Lumix Soroban Spot guards: Blux 0.3.7 */';
for (const format of formats) {
  const file = path.join(root, 'dist', format.file);
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(contractMarker)) continue;
  const esm = format.file === 'index.esm.js';
  const before = esm ? 'm=a.assembleTransaction(f,p).build(),[2,kE(m.toXDR(),{network:i})]'
    : 'p=e.rpc.assembleTransaction(f,h).build(),[2,GA(p.toXDR(),{network:o})]';
  const after = esm
    ? 'm=a.assembleTransaction(f,p).build(),[2,(async()=>{const xdr=m.toXDR();if(t.lumixBeforeSign)await t.lumixBeforeSign(xdr);return kE(xdr,{network:i,lumixBeforeSubmit:t.lumixBeforeSubmit})})()]'
    : 'p=e.rpc.assembleTransaction(f,h).build(),[2,(async()=>{const xdr=p.toXDR();if(n.lumixBeforeSign)await n.lumixBeforeSign(xdr);return GA(xdr,{network:o,lumixBeforeSubmit:n.lumixBeforeSubmit})})()]';
  if (source.split(before).length !== 2) throw new Error(`Unexpected Blux contract boundary in ${format.file}.`);
  source = source.replace(before, after) + `\n${contractMarker}\n`;
  fs.writeFileSync(file, source);
}
console.log('Blux 0.3.7 Spot guards ready.');
