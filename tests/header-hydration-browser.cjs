// Start Lumix on :3000 and Chromium with remote debugging on :9239.
const assert = require('node:assert/strict');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hydrationPattern = /hydration|hydrated|server rendered html|didn't match/i;
const origin = process.env.LUMIX_TEST_ORIGIN ?? 'http://localhost:3000';

(async () => {
  const target = await fetch(`http://127.0.0.1:9239/json/new?${encodeURIComponent(`${origin}/spot`)}`, { method: 'PUT' }).then(response => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve));

  let sequence = 0;
  const pending = new Map();
  let diagnostics = [];

  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const task = pending.get(data.id);
      pending.delete(data.id);
      data.error ? task.reject(data.error) : task.resolve(data.result);
      return;
    }

    if (data.method === 'Runtime.consoleAPICalled') {
      diagnostics.push(data.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '));
    }
    if (data.method === 'Runtime.exceptionThrown') {
      diagnostics.push(data.params.exceptionDetails.text ?? 'Runtime exception');
    }
    if (data.method === 'Log.entryAdded') diagnostics.push(data.params.entry.text);
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
  const waitFor = async (expression, message) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate(expression)) return;
      await sleep(125);
    }
    assert.fail(message);
  };
  const loadFresh = async (route, theme) => {
    diagnostics = [];
    await call('Page.navigate', { url: `${origin}${route}` });
    await sleep(900);
    await evaluate(`localStorage.setItem('lumix-theme', ${JSON.stringify(theme)})`);
    diagnostics = [];
    await call('Page.reload', { ignoreCache: true });
    await sleep(900);
    await waitFor("document.querySelector('.account-control--connect') && !document.querySelector('.account-control--connect').disabled", `${route} connect control did not become ready.`);
    assert.equal(diagnostics.some(message => hydrationPattern.test(message)), false, `${route} emitted hydration diagnostics:\n${diagnostics.join('\n')}`);
  };
  const showConnectedAccount = async address => {
    const connected = await evaluate(`(() => {
      const node = document.querySelector('h1');
      let fiber = node && node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
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
    assert.equal(connected, true, 'Wallet provider state was not available.');
    await sleep(150);
    await evaluate("document.querySelector('.account-control').click()");
    await sleep(100);
    const menuItems = await evaluate("Array.from(document.querySelectorAll('.account-menu-item')).map(item => item.textContent.trim())");
    assert.deepEqual(menuItems, ['Portfolio', 'Wallet', 'Disconnect wallet']);
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const routes = ['/spot', '/options', '/perpetuals', '/portfolio'];
  for (const [index, route] of routes.entries()) {
    const response = await fetch(`${origin}${route}`);
    const html = await response.text();
    assert.match(html, /class="account-control account-control--connect"[^>]*disabled=""/);
    await loadFresh(route, index % 2 ? 'light' : 'dark');
    await showConnectedAccount(`GHEADER${index}TEST`);
  }

  console.log('PASS: deterministic disabled SSR state, post-hydration readiness, no hydration diagnostics, connected/disconnected headers, account menu, routes, and themes.');
  socket.close();
  await fetch(`http://127.0.0.1:9239/json/close/${target.id}`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
