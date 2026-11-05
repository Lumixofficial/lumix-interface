// Browser-only fixtures in an isolated Chrome profile, never production records.
// Set LUMIX_TEST_ORIGIN to the running app; use an isolated browser on :9239.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserTestOrigin } = require('./helpers/browser-origin.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const origin = browserTestOrigin();
  const pages = await fetch('http://127.0.0.1:9239/json').then(r => r.json());
  const page = pages.find(p => p.url.startsWith(origin + '/'));
  assert.ok(page, 'Open the configured frontend origin in the test browser first.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve));
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { const task = pending.get(data.id); pending.delete(data.id); data.error ? task.reject(data.error) : task.resolve(data.result); } });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = async (selector, text) => { await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`); await sleep(100); };
  const wallet = async address => {
    await evaluate(`(() => {
      const node = document.querySelector('h1');
      let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
      while (fiber) {
        let hook = fiber.memoizedState;
        while (hook) {
          if (hook.queue?.dispatch && typeof hook.memoizedState?.sendTransaction === 'function') {
            hook.queue.dispatch({ ...hook.memoizedState, address: ${JSON.stringify(address)}, isAuthenticated: ${!!address}, isReady: true, isConnecting: false, balanceStatus: 'success', balances: {USDC: 1000}, getBalance: () => 1000 }); return true;
          }
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      throw new Error('Wallet provider not found');
    })()`);
    await sleep(200);
  };
  const capture = async (name, width, theme) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.setAttribute('data-theme', '${theme}'); window.scrollTo(0,0)`);
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'No page overflow');
    const metrics = await call('Page.getLayoutMetrics');
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
    fs.mkdirSync(path.resolve('.impeccable/review'), { recursive: true });
    fs.writeFileSync(path.resolve('.impeccable/review', name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await call('Page.enable');
  if (process.argv.includes('--sources')) {
    const address = 'GPORTFOLIO_BROWSER_SOURCE_TEST';
    const key = 'lumix:portfolio:v1:testnet:' + address;
    const now = Date.now();
    const base = { version: 1, wallet: address, network: 'testnet', spot: [], options: null, payments: [], outcomes: [] };
    await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(base))})`);
    const navigate = async route => { await call('Page.navigate', { url: origin + '/' + route }); await sleep(4000); await wallet(address); };
    await navigate('spot');
    await evaluate(`document.querySelector('.swap-primary-wrap button').click()`); await sleep(100);
    await click('.review-actions button', 'Swap XLM for USDC');
    await click('button', 'Sign preview transaction');
    await click('button', 'Confirm next ledger');
    const savedSpot = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
    assert.equal(savedSpot.spot.length, 1);
    assert.equal(savedSpot.spot[0].provenance, 'preview');
    assert.equal(savedSpot.spot[0].transactionHash, undefined);
    assert.equal(savedSpot.outcomes.length, 0);
    await navigate('portfolio');
    assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 1);
    assert.match(await evaluate('document.querySelector("tbody").innerText'), /1,000.00 XLM/);
    assert.match(await evaluate('document.body.innerText'), /No P&L data yet/);
    const order = { id: 'source-order', owner: 'GBCX7Q2L-LUMIX', pairId: 'XLM-USDC', optionSide: 'call', orderSide: 'buy', strike: 0.4, expirationId: '30-oct', contractSize: 100, settlementTerms: 'automatic-net', limitPremium: 1, quantity: 2, remainingQuantity: 2, createdAt: now, expiresAt: now + 86400000, status: 'open' };
    savedSpot.options = { orders: [order], positions: [], fills: [], notifications: [], sequence: 1 };
    const hash = 'b'.repeat(64);
    savedSpot.payments = [{ id: hash, at: now, position: { id: hash, marketId: 'XLM-USDC', side: 'long', size: 100, margin: 25, leverage: 1, entryPrice: 0.25, markPrice: 0.25, liquidationPrice: 0, transactionHash: hash, isTestnetDemo: true, status: 'open' } }];
    await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(savedSpot))})`);
    await navigate('options');
    await click('[role="tab"]', 'Unfilled');
    await click('.options-order-actions button', 'Cancel');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).options.orders[0].status`), 'cancelled');
    await navigate('portfolio');
    await click('[role="tab"]', 'Options');
    assert.match(await evaluate('document.querySelector("tbody").innerText'), /Cancelled/);
    await navigate('perpetuals');
    await click('button', 'Close position'); await sleep(1100);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).payments[0].hidden`), true);
    await navigate('portfolio'); await click('[role="tab"]', 'Perpetuals');
    assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 1);
    assert.match(await evaluate('document.body.innerText'), /No P&L data yet/);
    await navigate('perpetuals');
    await evaluate(`localStorage.setItem(${JSON.stringify(key)}, '{'); window.dispatchEvent(new Event('lumix-portfolio-records'))`); await sleep(100);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'LONG').disabled`), true);
    await navigate('portfolio');
    console.log('PASS: source Spot completion persists preview without hash or P&L; Options cancellation persists; removing Perps position keeps receipt; corrupt history blocks payment submission.');
    ws.close(); return;
  }
  await call('Page.navigate', { url: origin + '/portfolio' });
  await sleep(4000);
  await wallet(undefined);
  assert.match(await evaluate('document.body.innerText'), /Connect wallet to view your portfolio/);
  await capture('portfolio-disconnected', 1440, 'dark');
  const address = 'GPORTFOLIO_BROWSER_TEST_A';
  const key = 'lumix:portfolio:v1:testnet:' + address;
  const now = Date.now();
  const base = { version: 1, wallet: address, network: 'testnet', spot: [], options: null, payments: [], outcomes: [] };
  await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(base))})`);
  await wallet(address);
  assert.match(await evaluate('document.body.innerText'), /No P&L data yet/);
  await capture('portfolio-empty', 1440, 'light');
  const position = { id: 'position-1', fillId: 'fill-1', pairId: 'BTC-USDC', optionSide: 'call', direction: 'long', strike: 70000, expirationId: '30-oct', quantity: 3, premium: 42.125, counterparty: 'maker', openedAt: now - 86400000, status: 'open' };
  const fixture = { ...base,
    spot: Array.from({ length: 23 }, (_, i) => ({ id: 'swap-' + i, at: now - i * 86400000, paid: 100.125, paidAsset: 'USDC', received: 314.451, receivedAsset: 'XLM', fees: [{ amount: 0.3, asset: 'USD' }, { amount: 0.00001, asset: 'XLM' }], provenance: 'preview' })),
    options: { sequence: 1, orders: [], fills: [], notifications: [], positions: [position, { ...position, id: 'closed-1', quantity: 2, status: 'closed', closedAt: now, exitPremium: 50 }] },
    payments: [
      { id: 'a'.repeat(64), at: now, position: { id: 'a'.repeat(64), transactionHash: 'a'.repeat(64), marketId: 'ETH-USDC', side: 'short', margin: 50.125, size: 0.1, leverage: 1, entryPrice: 2000, markPrice: 2000, liquidationPrice: 0, status: 'open', isTestnetDemo: true } },
      { id: 'b'.repeat(64), at: now - 1000, position: { id: 'b'.repeat(64), transactionHash: 'b'.repeat(64), marketId: 'BTC-USDC', side: 'long', margin: 75.5, size: 0.001, leverage: 1, entryPrice: 70000, markPrice: 70000, liquidationPrice: 0, status: 'open', isTestnetDemo: true } },
    ],
    outcomes: [10, -3, 12].map((amount, i) => ({ id: 'verified-test-' + i, at: now - (3 - i) * 86400000, product: i === 1 ? 'perpetuals' : 'options', kind: 'trade-close', provenance: 'confirmed', currency: 'USDC', pnl: { basis: 'net', amount } }))
  };
  await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(fixture))}); window.dispatchEvent(new Event('lumix-portfolio-records'))`);
  await sleep(200);
  assert.match(await evaluate('document.querySelector(".portfolio-pnl-value").innerText'), /19.00/);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("thead th")).map(cell => cell.textContent.trim())'), ['Date', 'Pair', 'Paid', 'Received', 'Fee', 'Status', 'Transaction']);
  assert.equal(await evaluate('document.querySelector("tbody tr td:nth-child(2) small") === null'), true);
  assert.match(await evaluate('document.querySelector("tbody tr td:nth-child(6)").textContent'), /Completed · preview/);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 20);
  await click('button', 'Load more');
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 23);
  await capture('portfolio-spot-desktop-light', 1440, 'light');
  await capture('portfolio-mobile-dark', 390, 'dark');
  assert.equal(await evaluate('document.querySelector(".portfolio-table-scroll").scrollWidth > document.querySelector(".portfolio-table-scroll").clientWidth'), true);
  await click('[aria-label="P&L view"] button', 'Options');
  await click('[aria-label="P&L period"] button', 'All');
  await click('[role="tab"]', 'Options');
  assert.match(await evaluate('document.querySelector(".portfolio-pnl-value").innerText'), /22.00/);
  assert.match(await evaluate('document.querySelector("tbody").innerText'), /Filled.*preview/);
  assert.equal(await evaluate('document.querySelectorAll("tbody details").length'), 0);
  assert.equal(await evaluate('document.querySelector("tbody .trade-badge--long").textContent.trim()'), 'Buy');
  assert.equal(await evaluate('document.querySelector("tbody .trade-badge--short").textContent.trim()'), 'Sell');
  assert.equal(await evaluate('document.querySelector("tbody .portfolio-pnl-cell.is-unavailable").textContent.trim()'), '—');
  await capture('portfolio-desktop-dark', 1440, 'dark');
  await capture('portfolio-mobile-light', 390, 'light');
  await click('[role="tab"]', 'Perpetuals');
  assert.equal(await evaluate(`document.querySelector('[aria-label="P&L view"] [aria-pressed=true]').textContent`), 'Options');
  assert.equal(await evaluate(`document.querySelector('[aria-label="P&L period"] [aria-pressed=true]').textContent`), 'All');
  assert.equal(await evaluate('document.querySelector("tbody .trade-badge--short").textContent.trim()'), 'Short');
  assert.equal(await evaluate('document.querySelector("tbody .trade-badge--long").textContent.trim()'), 'Long');
  assert.equal(await evaluate('document.querySelector("tbody .portfolio-pnl-cell.is-unavailable").textContent.trim()'), '—');
  assert.match(await evaluate('document.querySelector("tbody a").href'), /stellar\.expert\/explorer\/testnet\/tx\/[a-f0-9]{64}$/);
  await capture('portfolio-desktop-light', 1440, 'light');
  await wallet('GPORTFOLIO_BROWSER_TEST_B');
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 0);
  assert.match(await evaluate('document.body.innerText'), /No P&L data yet/);
  await wallet(address);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 2);
  await call('Page.reload'); await sleep(4000); await wallet(address);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 20);
  await evaluate(`localStorage.setItem(${JSON.stringify(key)}, '{'); window.dispatchEvent(new Event('lumix-portfolio-records'))`); await sleep(200);
  assert.match(await evaluate('document.body.innerText'), /Portfolio could not be loaded/);
  await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(fixture))})`);
  await click('button', 'Retry');
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 20);
  await wallet(undefined);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 0);
  console.log('PASS: disconnected/empty/error/retry, chart totals, independent selections, pagination, explorer URL, wallet switching, refresh persistence, both themes and responsive overflow. Fixtures only; no real wallet transactions.');
  ws.close();
})().catch(error => { console.error(error); process.exit(1); });
