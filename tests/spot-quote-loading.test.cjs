require('@next/env').loadEnvConfig(process.cwd());
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, filename);
require.extensions['.ts'] = compile; require.extensions['.tsx'] = compile;
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const api = require('../components/spot-api.ts');
const m = require('../components/spot-utils.ts');
const { SpotQuoteOptions } = require('../components/spot-quote-options.tsx');
const { AppFooter } = require('../components/app-footer.tsx');
const { issuer } = require('./helpers/spot-api-fixture.cjs');

const request = { from: m.spotAsset('XLM', undefined, 'mainnet'), to: m.spotAsset('USDC', issuer, 'mainnet'), amount: '100' };
const native = api.spotCandidates({ key: m.spotRequestKey(request), request, route: [request.from, request.to], output: '102' }, undefined, request);
const options = props => renderToStaticMarkup(createElement(SpotQuoteOptions, {
  quotes: native, selected: native[0], onSelect() {}, onRetry() {}, disabled: false, loading: false, resolving: false, apiEnabled: true, ...props,
}));
const idle = { isFetching: false, isFetchedAfterMount: true };

test('a new request resolves only after the debounce and every enabled source answers once', () => {
  const firstFetch = { isFetching: true, isFetchedAfterMount: false };
  assert.equal(api.spotQuotesResolving({ debouncing: true, native: idle, configPending: false, api: idle }), true);
  assert.equal(api.spotQuotesResolving({ debouncing: false, native: idle, configPending: true, api: undefined }), true);
  assert.equal(api.spotQuotesResolving({ debouncing: false, native: idle, configPending: false, api: firstFetch }), true);
  assert.equal(api.spotQuotesResolving({ debouncing: false, native: firstFetch, configPending: false, api: idle }), true);
  assert.equal(api.spotQuotesResolving({ debouncing: false, native: idle, configPending: false, api: idle }), false);
  assert.equal(api.spotQuotesResolving({ debouncing: false, native: undefined, configPending: false, api: undefined }), false);
});

test('background refreshes keep resolved quotes on screen', () => {
  const refreshing = { isFetching: true, isFetchedAfterMount: true };
  assert.equal(api.spotQuotesResolving({ debouncing: false, native: refreshing, configPending: false, api: refreshing }), false);
});

test('resolving shows one Finding routes box and no preliminary quote', () => {
  const html = options({ resolving: true, loading: true });
  assert.equal(html.match(/class="spot-quote-loading"/g)?.length, 1);
  assert.match(html, /role="status"[^>]*>.*Finding routes…/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /radiogroup|Stellar AMM|102\.0000000|\d+ quotes?<|No Soroban route/);
});

test('resolved quotes render as selectable cards without the loading box', () => {
  const html = options();
  assert.doesNotMatch(html, /spot-quote-loading|Finding routes/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /Stellar AMM \/ order book/);
  assert.match(html, />1 quote</);
});

test('footer Discord link opens the Lumix server in a new tab', () => {
  const discord = renderToStaticMarkup(createElement(AppFooter)).match(/<a[^>]*aria-label="Discord"[^>]*>/)?.[0];
  assert.ok(discord);
  assert.match(discord, /href="https:\/\/discord\.gg\/P4DStQtmP7"/);
  assert.match(discord, /target="_blank"/);
  assert.match(discord, /rel="noopener noreferrer"/);
});
