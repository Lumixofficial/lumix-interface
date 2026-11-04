// Freighter protocol fixture for disposable Testnet accounts only. Private
// keys stay in Node; each signing request requires a visible approval click.
const { Networks, TransactionBuilder, hash } = require('@stellar/stellar-sdk');
async function installSpotTestWallet(context, keypair, { signingNetwork = Networks.TESTNET } = {}) {
  const address = keypair.publicKey();
  // Disposable transactions must never enter the real ingestion service.
  // Individual page routes can override this to inspect reporting behavior.
  await context.route('**/v1/spot/swaps/record', route => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 202,
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' },
    body: '',
  }));
  await context.exposeBinding('__spotWalletAction', async (_source, request) => {
    if (request.type === 'SUBMIT_BLOB') {
      const payload = Buffer.from(`Stellar Signed Message:\n${request.blob}`, 'utf8');
      return { signedBlob: Buffer.from(keypair.sign(hash(payload))).toString('base64'), signerAddress: address };
    }
    if (request.type === 'SUBMIT_TRANSACTION') {
      if (request.networkPassphrase !== signingNetwork) throw new Error('The disposable wallet refuses signing on a different network.');
      const tx = TransactionBuilder.fromXDR(request.transactionXdr, signingNetwork);
      if (tx.source !== address) throw new Error('The disposable wallet refuses a different transaction source.');
      tx.sign(keypair);
      return { signedTransaction: tx.toXDR(), signerAddress: address };
    }
    throw new Error('Unsupported disposable-wallet request.');
  });
  await context.addInitScript(({ address, passphrase }) => {
    window.freighter = true;
    window.__spotTestWallet = { network: passphrase, requests: [], approvals: 0 };
    const approve = request => new Promise(resolve => {
      const modal = document.createElement('div');
      modal.dataset.testWallet = 'confirmation'; modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-label', 'Disposable Testnet wallet');
      Object.assign(modal.style, { position: 'fixed', zIndex: '2147483647', inset: '20% 8%', padding: '32px', background: '#16161a', color: 'white', border: '2px solid #2e5cff', borderRadius: '16px', font: '16px sans-serif' });
      const label = document.createElement('p');
      label.textContent = `Disposable Testnet wallet · ${request.type === 'SUBMIT_TRANSACTION' ? 'Approve transaction' : 'Approve login'} · ${address}`;
      modal.append(label);
      for (const [text, allowed] of [['Approve test wallet request', true], ['Reject test wallet request', false]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
        Object.assign(button.style, { padding: '14px', margin: '8px', background: allowed ? '#2e5cff' : '#333', color: 'white', border: '0', borderRadius: '8px' });
        button.onclick = async () => {
          button.disabled = true;
          let response;
          if (allowed) {
            window.__spotTestWallet.approvals += 1;
            try { response = await window.__spotWalletAction(request); }
            catch (error) { response = { apiError: { code: -1, message: error.message } }; }
          } else response = { apiError: { code: -4, message: 'The user rejected this request.' } };
          modal.remove(); resolve(response);
        };
        modal.append(button);
      }
      document.body.append(modal);
    });
    window.addEventListener('message', async event => {
      if (event.source !== window || event.data?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
      const request = event.data; const state = window.__spotTestWallet;
      state.requests.push(request.type);
      const current = state.network;
      let response = {};
      if (['REQUEST_PUBLIC_KEY', 'REQUEST_ACCESS', 'REQUEST_USER_INFO'].includes(request.type)) response = { publicKey: address, address, isAllowed: true };
      else if (['REQUEST_ALLOWED_STATUS', 'SET_ALLOWED_STATUS'].includes(request.type)) response = { isAllowed: true };
      else if (request.type === 'REQUEST_CONNECTION_STATUS') response = { isConnected: true };
      else if (request.type === 'REQUEST_NETWORK') response = { network: current === 'Test SDF Network ; September 2015' ? 'TESTNET' : 'PUBLIC', networkPassphrase: current };
      else if (request.type === 'REQUEST_NETWORK_DETAILS') response = { networkDetails: { network: 'TESTNET', networkPassphrase: current, networkUrl: 'https://horizon-testnet.stellar.org', sorobanRpcUrl: 'https://soroban-testnet.stellar.org' } };
      else if (['SUBMIT_BLOB', 'SUBMIT_TRANSACTION'].includes(request.type)) response = await approve(request);
      else response = { apiError: { code: -1, message: `Unsupported Testnet fixture request: ${request.type}` } };
      window.postMessage({ ...response, source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: request.messageId }, location.origin);
    });
  }, { address, passphrase: signingNetwork });
  return address;
}
module.exports = { installSpotTestWallet };
