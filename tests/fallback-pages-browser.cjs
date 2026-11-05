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
  const navigate = async route => {
    await call('Page.navigate', { url: `${origin}${route}` });
    await sleep(1100);
  };
  const clickExact = async (selector, text) => {
    const clicked = await evaluate(`(() => {
      const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(candidate => candidate.textContent.trim() === ${JSON.stringify(text)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    assert.equal(clicked, true, `Expected ${text} control.`);
    await sleep(650);
  };
  const connectWallet = async address => {
    const connected = await evaluate(`(() => {
      const node = document.querySelector('h1');
      let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
      while (fiber) {
        let hook = fiber.memoizedState;
        while (hook) {
          if (hook.queue?.dispatch && typeof hook.memoizedState?.sendTransaction === 'function') {
            const balances = { USDC: 1000, XLM: 1000 };
            hook.queue.dispatch({ ...hook.memoizedState, address: ${JSON.stringify(address)}, isAuthenticated: true, isReady: true, isConnecting: false, balanceStatus: 'success', balances, getBalance: asset => balances[asset] ?? 0 });
            return true;
          }
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      return false;
    })()`);
    assert.equal(connected, true, 'Wallet provider should remain available in fallback screens.');
    await sleep(250);
  };
  const capture = async (name, width, theme) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); window.scrollTo(0, 0)`);
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `${name} must not overflow horizontally.`);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const directory = path.resolve('.impeccable/review');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  };

  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await evaluate("sessionStorage.removeItem('lumix:last-available-route')");
  await navigate('/spot');
  assert.ok(await evaluate("document.querySelector('.spot-page') !== null"));
  assert.equal(await evaluate("document.querySelectorAll('.header-product-nav a').length"), 5);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.header-product-nav a')).find(link => link.textContent.trim() === 'Earn').getAttribute('href')"), '/earn');
  await clickExact('.header-product-nav a', 'Earn');
  assert.equal(await evaluate('location.pathname'), '/earn');
  assert.equal(await evaluate("document.querySelector('.earn-page h1').textContent"), 'Earn');
  assert.equal(await evaluate("document.querySelector('.app-status-content')"), null);
  assert.ok(await evaluate("document.querySelector('.header-product-nav .is-active').textContent.trim() === 'Earn'"));
  await clickExact('.header-product-nav a', 'Spot');
  assert.equal(await evaluate('location.pathname'), '/spot', 'Earn keeps the product navigation available.');

  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('/portfolio');
  assert.ok(await evaluate("document.querySelector('.portfolio-page') !== null"), 'Portfolio should render its existing page.');
  assert.equal(await evaluate("document.querySelector('.app-status-content')"), null);
  await connectWallet('GFALLBACK_BROWSER_TEST');
  assert.ok(await evaluate("document.querySelector('.account-control').textContent.includes('GFALL')"), 'Portfolio should work while connected.');
  await clickExact('.header-product-nav a', 'Earn');
  await clickExact('.header-product-nav a', 'Portfolio');
  assert.equal(await evaluate('location.pathname'), '/portfolio', 'Portfolio stays available from Earn.');

  await evaluate("sessionStorage.removeItem('lumix:last-available-route')");
  await navigate('/earn');
  assert.equal(await evaluate("document.querySelector('.earn-page h1').textContent"), 'Earn', 'Direct Earn entry renders the pool workspace.');

  const missingRoute = `/missing-${Date.now()}`;
  const missingResponse = await fetch(`${origin}${missingRoute}`);
  assert.equal(missingResponse.status, 404, 'Unknown URLs must preserve a 404 response.');
  await navigate('/options');
  await navigate(missingRoute);
  assert.match(await evaluate("document.querySelector('.app-status-content').innerText"), /404[\s\S]*Page not found[\s\S]*The page you’re looking for doesn’t exist or has moved\.[\s\S]*Go back/);
  assert.equal(await evaluate("document.querySelector('.header-product-nav .is-active')"), null, '404 must not claim an active product.');
  await capture('not-found-desktop-light', 1440, 'light');
  await capture('not-found-mobile-dark', 390, 'dark');
  await connectWallet('GNOTFOUND_BROWSER_TEST');
  assert.ok(await evaluate("document.querySelector('.account-control').textContent.includes('GNOTF')"), 'Not Found must work while connected.');
  await clickExact('.app-status-action', 'Go back');
  assert.equal(await evaluate('location.pathname'), '/options', '404 should return to the previous available route.');

  await evaluate("sessionStorage.setItem('lumix:last-available-route', '/earn')");
  await navigate(`/missing-after-earn-${Date.now()}`);
  await clickExact('.app-status-action', 'Go back');
  assert.equal(await evaluate('location.pathname'), '/earn', 'Earn is now an available return destination.');

  await evaluate("sessionStorage.setItem('lumix:last-available-route', '/unavailable')");
  await navigate(`/missing-unavailable-${Date.now()}`);
  await clickExact('.app-status-action', 'Go back');
  assert.equal(await evaluate('location.pathname'), '/spot', 'Unavailable return targets should fall back to Spot.');

  await evaluate("sessionStorage.removeItem('lumix:last-available-route')");
  await navigate(`/missing-direct-${Date.now()}`);
  await clickExact('.app-status-action', 'Go back');
  assert.equal(await evaluate('location.pathname'), '/spot', 'Direct 404 entry should fall back to Spot.');

  console.log('PASS: previous-route navigation, direct-entry and unavailable-route fallback, Portfolio and Earn availability, native 404 status, both themes, and mobile/desktop layouts.');
  socket.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
