const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(
  fs.readFileSync(path, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, path);

const {
  APP_ROUTES,
  FEATURES,
  PRODUCT_NAVIGATION,
  isAvailableProductRoute,
  resolveAvailableReturnRoute,
} = require('../components/app-routes.ts');

test('feature availability is centralized and matches the launch configuration', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FEATURES).map(([feature, configuration]) => [feature, configuration.comingSoon])),
    { spot: false, options: true, perpetuals: true, earnVaults: true, portfolio: true },
  );
});

test('every product remains navigable and Spot is the shared home destination', () => {
  assert.equal(APP_ROUTES.home, APP_ROUTES.spot);
  assert.equal(PRODUCT_NAVIGATION.length, 5);
  assert.deepEqual(PRODUCT_NAVIGATION.map(item => item.route), [
    '/spot',
    '/options',
    '/perpetuals',
    '/earn',
    '/portfolio',
  ]);
  assert.equal(new Set(PRODUCT_NAVIGATION.map(item => item.route)).size, PRODUCT_NAVIGATION.length);
});

test('back navigation accepts only currently available product routes', () => {
  assert.equal(isAvailableProductRoute('/spot'), true);
  for (const route of ['/portfolio', '/earn', '/options', '/perpetuals']) {
    assert.equal(isAvailableProductRoute(route), false);
    assert.equal(resolveAvailableReturnRoute(route), APP_ROUTES.spot);
  }
  assert.equal(resolveAvailableReturnRoute('/missing'), APP_ROUTES.spot);
  assert.equal(resolveAvailableReturnRoute('https://example.com'), APP_ROUTES.spot);
  assert.equal(resolveAvailableReturnRoute(null), APP_ROUTES.spot);
});
