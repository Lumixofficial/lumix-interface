// Browser fixtures in an isolated Chrome profile. Set LUMIX_TEST_ORIGIN and start
// Chromium with remote debugging on :9239 before running this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserTestOrigin } = require('./helpers/browser-origin.cjs');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const origin = browserTestOrigin();
  const pages = await fetch('http://127.0.0.1:9239/json').then(response => response.json());
  const page = pages.find(candidate => candidate.url.startsWith(origin + '/'));
  assert.ok(page, 'Open the configured frontend origin in the test browser first.');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve));
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (!data.id) return;
    const task = pending.get(data.id);
    pending.delete(data.id);
    data.error ? task.reject(data.error) : task.resolve(data.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const clickExact = async (selector, text) => {
    const clicked = await evaluate(`(() => {
      const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(candidate => candidate.textContent.trim() === ${JSON.stringify(text)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    assert.equal(clicked, true, `Expected ${text} control.`);
    await sleep(180);
  };
  const setInput = async value => {
    await evaluate(`(() => {
      const input = document.querySelector('.option-strike-input input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(180);
  };
  const connectWallet = async address => {
    await evaluate(`(() => {
      const node = document.querySelector('h1');
      let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
      while (fiber) {
        let hook = fiber.memoizedState;
        while (hook) {
          if (hook.queue?.dispatch && typeof hook.memoizedState?.sendTransaction === 'function') {
            const balances = { USDC: 1000, XLM: 1000, BTC: 2, ETH: 20 };
            hook.queue.dispatch({ ...hook.memoizedState, address: ${JSON.stringify(address)}, isAuthenticated: true, isReady: true, isConnecting: false, balanceStatus: 'success', balances, getBalance: asset => balances[asset] ?? 0 });
            return true;
          }
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      return false;
    })()`);
    await sleep(350);
  };
  const capture = async (name, width, theme) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
    await evaluate("document.querySelector('.option-drawer-scroll').scrollTop = document.querySelector('.option-drawer-scroll').scrollHeight");
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Page must not overflow horizontally.');
    assert.equal(await evaluate(`(() => {
      const feedback = document.querySelector('.option-feedback-area')?.getBoundingClientRect();
      const footer = document.querySelector('.option-drawer-action')?.getBoundingClientRect();
      return !feedback || !footer || feedback.bottom <= footer.top + 0.5;
    })()`), true, 'Feedback must remain fully above the submit area.');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const directory = path.resolve('.impeccable/review');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  };

  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
  const address = 'GOPTIONS_DRAWER_BROWSER_TEST';
  const storageKey = `lumix:portfolio:v1:testnet:${address}`;
  const emptyRecords = { version: 1, wallet: address, network: 'testnet', spot: [], options: null, payments: [], outcomes: [] };
  await call('Page.navigate', { url: origin + '/options' });
  await sleep(3500);
  await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(emptyRecords))})`);
  assert.equal(await connectWallet(address), undefined);
  await clickExact('button', 'Create order');

  assert.equal(await evaluate("document.querySelector('.option-strike-input input').value"), '0.25');
  assert.equal(await evaluate("document.querySelectorAll('.option-builder-pills').length"), 0);

  await setInput('0.2555');
  await clickExact('.option-builder-side button', 'Put');
  await clickExact('.option-order-side-toggle button', 'Sell');
  assert.equal(await evaluate("document.querySelector('.option-strike-input input').value"), '0.2555', 'Strike must survive option-side and order-side changes.');

  await clickExact('.option-trade-view-tabs button', 'Profit Simulation');
  const strikeMarkerBefore = await evaluate("document.querySelector('.option-chart-marker--strike').getAttribute('x1')");
  await setInput('0.3');
  const strikeMarkerAfter = await evaluate("document.querySelector('.option-chart-marker--strike').getAttribute('x1')");
  assert.notEqual(strikeMarkerAfter, strikeMarkerBefore, 'Payoff chart must recalculate for a valid strike.');
  assert.equal(await evaluate("document.querySelector('.option-summary-contract')"), null, 'Only the selected trade subview should render.');

  await clickExact('.option-trade-view-tabs button', 'Order Summary');
  await setInput('0.25555');
  assert.equal(await evaluate("document.querySelector('.option-strike-input input').getAttribute('aria-invalid')"), 'true');
  assert.match(await evaluate("document.querySelector('.option-feedback-area').innerText"), /up to 4 decimal places/);
  assert.equal(await evaluate("document.querySelector('.option-drawer-action button').disabled"), true);
  assert.equal(await evaluate("document.querySelector('.option-feedback-area').previousElementSibling.id"), 'option-order-summary-panel', 'Summary feedback must immediately follow its total.');
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('.option-trade-view-panel');
    const feedback = document.querySelector('.option-feedback-area');
    const footer = document.querySelector('.option-drawer-action');
    return Boolean(panel.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(feedback.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`), true, 'Feedback must follow the active content and precede the submit area.');
  await clickExact('.option-trade-view-tabs button', 'Profit Simulation');
  assert.ok(await evaluate("document.querySelector('.option-feedback-area') !== null"), 'Validation feedback must remain visible while switching trade subviews.');
  await clickExact('.option-trade-view-tabs button', 'Order Summary');
  await evaluate("document.querySelector('.option-drawer-scroll').scrollTop = document.querySelector('.option-drawer-scroll').scrollHeight");
  await sleep(120);
  await capture('options-strike-error-mobile-light', 520, 'light');

  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
  await setInput('0.2555');
  await clickExact('.option-trade-view-tabs button', 'Order Summary');
  await evaluate("document.querySelector('.option-strike-input input').blur()");
  await sleep(120);
  await evaluate("document.querySelector('.option-drawer-action button').click()");
  await sleep(220);
  assert.match(await evaluate("document.querySelector('.option-submission-result.is-success').innerText"), /Order processed/);
  await clickExact('.option-trade-view-tabs button', 'Profit Simulation');
  assert.ok(await evaluate("document.querySelector('.option-submission-result.is-success') !== null"), 'Feedback must remain visible while switching trade subviews.');
  await evaluate("document.querySelector('.option-drawer-scroll').scrollTop = document.querySelector('.option-drawer-scroll').scrollHeight");
  await sleep(120);
  await capture('options-strike-success-desktop-dark', 1440, 'dark');

  await evaluate("document.querySelector('.option-drawer-close').click()");
  await sleep(350);
  const openedListed = await evaluate(`(() => {
    const quote = document.querySelector('.option-quote-button:not(:disabled)');
    if (!quote) return false;
    quote.click();
    return true;
  })()`);
  assert.equal(openedListed, true);
  await sleep(250);
  assert.equal(await evaluate("document.querySelector('.option-strike-input')"), null, 'Listed contracts must retain their fixed strike.');

  console.log('PASS: editable creation strike, recalculation, precision/range feedback, Buy/Sell and Call/Put persistence, shared feedback placement, fixed listed strikes, light mobile and dark desktop.');
  socket.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
