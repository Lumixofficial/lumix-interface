const { test, expect } = require('@playwright/test');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { issuer } = require('./helpers/spot-api-fixture.cjs');
const root = path.resolve(__dirname, '..');
// The second instance gets an OS-selected port, proving there is no port dependency.
const ports = process.env.PROXY_TEST_PORTS?.split(',').map(Number) ?? [3002, 0];

for (const port of ports) test.describe(`production same-origin proxy, ${port || 'ephemeral port'}`, () => {
  let upstream, frontend, origin;
  const received = [];

  test.beforeAll(async () => {
    upstream = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      received.push({ method: request.method, path: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
      // Deliberately no CORS headers. Only the Next.js server can reach this fixture.
      response.writeHead(202, { 'Cache-Control': 'no-store' }).end();
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const backend = `http://127.0.0.1:${upstream.address().port}/backend///`;
    frontend = spawn(process.execPath, [
      path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port),
    ], { cwd: root, env: { ...process.env, NODE_ENV: 'production', LUMIX_API_URL: port ? backend : '', API_URL: backend }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', failure;
    frontend.stdout.on('data', data => { output += data; });
    frontend.stderr.on('data', data => { output += data; });
    frontend.on('error', error => { failure = error; });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (failure || frontend.exitCode !== null) throw new Error('The isolated production frontend failed to start.');
      const url = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (url) {
        origin = `http://localhost:${url[1]}`;
        try {
          const ready = await fetch(`${origin}/api/spot/quotes`, { signal: AbortSignal.timeout(1000) });
          if (ready.ok) return;
        } catch { /* Wait for this fixture's server, never an unrelated process. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The isolated production frontend did not become ready.');
  });

  test.afterAll(async () => {
    if (frontend && frontend.exitCode === null) {
      const exited = once(frontend, 'exit');
      frontend.kill();
      await exited;
    }
    if (upstream?.listening) {
      const closed = new Promise(resolve => upstream.close(resolve));
      upstream.closeAllConnections();
      await closed;
    }
  });

  for (const venue of ['STELLAR_NATIVE', 'CONTRACT_AGGREGATOR']) {
    test(`${venue} reaches the backend through the active frontend origin without a preflight`, async ({ page }) => {
      await page.route('https://**', route => route.abort());
      await page.goto(`${origin}/spot`);
      const requests = [];
      page.on('request', request => {
        if (request.url().includes('/swaps/record')) requests.push({ url: request.url(), method: request.method() });
      });
      const payload = { txHash: 'b'.repeat(64), sender: issuer, venue, route: { path: ['XLM', 'USDC'] } };
      const result = await page.evaluate(async body => {
        const response = await fetch('/api/spot/swaps/record', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { url: response.url, status: response.status, body: await response.text() };
      }, payload);
      expect(result).toEqual({ url: `${origin}/api/spot/swaps/record`, status: 202, body: '' });
      expect(requests).toEqual([{ url: `${origin}/api/spot/swaps/record`, method: 'POST' }]);
      expect(received.at(-1).body).toEqual(payload);
      expect(received.at(-1).path).toBe('/backend/v1/spot/swaps/record');
      expect(received.at(-1).headers.origin).toBeUndefined();
      expect(received.every(request => request.method === 'POST')).toBe(true);
    });
  }
});
