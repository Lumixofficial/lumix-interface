// Set LUMIX_TEST_ORIGIN and start an isolated Chromium on debug port :9239.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserTestOrigin } = require('./helpers/browser-origin.cjs');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const origin = browserTestOrigin();

(async () => {
  const target = await fetch(`http://127.0.0.1:9239/json/new?${encodeURIComponent(`${origin}/perpetuals`)}`, { method: 'PUT' }).then(response => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
  const showConfirmation = async () => {
    const updated = await evaluate(`(() => {
      const node = document.querySelector('.perp-order-panel');
      let fiber = node && node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
      while (fiber) {
        const hooks = [];
        let hook = fiber.memoizedState;
        while (hook) { hooks.push(hook); hook = hook.next; }
        if (hooks[0]?.memoizedState === 'long' && hooks[5]?.queue?.dispatch && hooks[6]?.queue?.dispatch && hooks[8]?.queue?.dispatch) {
          hooks[5].queue.dispatch('success');
          hooks[6].queue.dispatch('Payment confirmed.');
          hooks[8].queue.dispatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
          return true;
        }
        fiber = fiber.return;
      }
      return false;
    })()`);
    assert.equal(updated, true, 'Perpetual order feedback state was not available.');
    await sleep(200);
  };
  const capture = async (name, width, theme) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.querySelector('.perp-order-feedback').scrollIntoView({ block: 'center' })`);
    await sleep(100);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const directory = path.resolve('.impeccable/review');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  };

  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);
  await showConfirmation();

  const layout = await evaluate(`(() => {
    const feedback = document.querySelector('.perp-order-feedback');
    const message = feedback.querySelector('.perp-order-feedback-message');
    const actions = feedback.querySelector('.perp-order-feedback-actions');
    const link = actions.querySelector('a');
    const button = actions.querySelector('button');
    const messageRect = message.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      message: message.textContent.trim(),
      actions: Array.from(actions.children).map(node => node.textContent.trim()),
      href: link.href,
      display: getComputedStyle(actions).display,
      wrap: getComputedStyle(actions).flexWrap,
      rowGap: parseFloat(getComputedStyle(actions).rowGap),
      columnGap: parseFloat(getComputedStyle(actions).columnGap),
      ordered: messageRect.bottom <= actionsRect.top,
      buttonOverlap: !(link.getBoundingClientRect().right <= button.getBoundingClientRect().left || button.getBoundingClientRect().right <= link.getBoundingClientRect().left || link.getBoundingClientRect().bottom <= button.getBoundingClientRect().top || button.getBoundingClientRect().bottom <= link.getBoundingClientRect().top),
    };
  })()`);
  assert.equal(layout.message, 'Payment confirmed.');
  assert.deepEqual(layout.actions, ['View on Stellar Expert', 'Dismiss']);
  assert.match(layout.href, /stellar\.expert\/explorer\/testnet\/tx\/a{64}$/);
  assert.equal(layout.display, 'flex');
  assert.equal(layout.wrap, 'wrap');
  assert.ok(layout.rowGap > 0 && layout.columnGap > 0);
  assert.equal(layout.ordered, true);
  assert.equal(layout.buttonOverlap, false);

  await capture('perpetual-confirmation-desktop-dark', 1440, 'dark');
  await capture('perpetual-confirmation-mobile-light', 390, 'light');
  await evaluate("Array.from(document.querySelectorAll('.perp-order-feedback button')).find(button => button.textContent.trim() === 'Dismiss').click()");
  await sleep(150);
  assert.equal(await evaluate("document.querySelector('.perp-order-feedback') === null"), true);

  console.log('PASS: payment confirmation hierarchy, aligned wrapping actions, testnet link, manual dismissal, themes, and responsive layout.');
  socket.close();
  await fetch(`http://127.0.0.1:9239/json/close/${target.id}`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
