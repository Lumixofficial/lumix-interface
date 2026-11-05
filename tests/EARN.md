# Earn verification

`/earn` and `/earn/[poolId]` share the existing app shell and a route-layout
provider. Six pools, five prices, balances, principal and earned fees are local
fixtures. Buy adds one chosen asset to the position; Sell returns that asset
from supplied holdings. Both reuse exact integer accounting and the processing
gate. No pool services, contracts, swaps, wallet balances or signing are used.
Authentication and Connect wallet use the existing global provider.

A versioned session-storage journal stores only validated commands. It replays
exact balances, positions, composition and activity after refresh or leaving
Earn. Malformed journals reset safely. No live account data is stored. The
interface omits mock-related labels; disconnected views hide personal figures
while allowing public browsing. The data and transaction behavior remain local.

The list retains sorting, metric text help, official icons, initial skeletons and
three-record scroll batches. The sentinel adds no separator beneath the last
row. Display-order numbers continue across batches; a stretched native link
makes each complete row clickable, with app hover and keyboard focus styles.
Pool links support browser history, new tabs and direct entry; unknown IDs receive
a pool-specific not-found page with the header, footer and Back to Earn link.

The local Lightweight Charts 5.2.1 canvas component shows total deposits in USD,
with hourly, deterministic 90-day history ending at October 2, 2026, 12:00 UTC.
1D, 1W, 1M and All select different data. New actions append exact corresponding
observations. Mouse, touch and keyboard inspection share a clamped tooltip;
ResizeObserver handles container sizing. A fixed-height initial skeleton
preserves the chart layout. Chart attribution follows the library's NOTICE.
The logo and old chart-footer labels are removed; a small linked copyright
credit remains, with the full NOTICE in its accessible name and title.

Pool composition uses each asset's USD share, not token count. Funding actions
update deposits and composition but do not fabricate perpetual trading volume,
24-hour trading fees or personal fees earned. Simulated execution fees are zero.
Recent transactions begin with eight local rows; Load more reveals eight more.
Completed actions appear first. Full account identifiers are checked with the
Stellar SDK's StrKey checksum validator before linking to the configured
network's Stellar Expert account page. Invalid public fixture identifiers remain
plain text. Personal actions use the connected wallet's full address for display.

Desktop places the chart, statistics and activity beside the management panel.
The panel sticks only when it fits below the actual header; otherwise it stays
in document flow. Mobile places management immediately after the chart and
uses compact activity records. The app footer follows the complete content.

Run focused checks:
Set `PORT` to the port of the running frontend; no browser harness assumes a port.

```powershell
npm run lint:earn
npm run typecheck
npm run test:earn
npm run build
$env:EARN_TEST_BASE_URL = "http://localhost:$env:PORT"
npm run test:earn:browser
```

The 60 model tests include six detail/history/journal tests and the existing
exact amount, validation, conservation, sorting and duplicate-submission cases.
The nine browser cases cover all pool links, direct entry/refresh/back/forward,
unknown IDs, chart loading/ranges/inspection/resizing, connected/disconnected
states, Buy/Sell accounting, precision and Max, activity updates, layout order,
shared styles, list borders and the no-integration source guard. Wallet fixtures
are isolated in tests and never imported by the app.

Two refinement cases cover the exact Options Buy/Sell styles, shared custom
asset dropdown (icons/names/symbols, keyboard, Escape, outside dismissal),
amount precision validation, pool descriptions, numbered whole-row navigation,
new tabs, and desktop/mobile wallet states. To run only these checks:

```powershell
$env:EARN_TEST_BASE_URL = "http://localhost:$env:PORT"
node node_modules/@playwright/test/cli.js test --config=playwright.earn.config.cjs --grep 'refinement desktop|refinement mobile'
npm run typecheck
```

This refinement pass ran only those two browser cases and the type check.
See `.impeccable/review/earn-refinements-verification.md` for the result.

Two overview cases cover the full-width artwork, TVL help (hover, focus and touch
hold), whole-dollar table amounts, independent 30D performance sorting, heading
alignment, valid account links, hidden personal figures while disconnected,
removed mock-related wording, and consolidated Execution details. They also
check exact input precision and absence of horizontal overflow on mobile.

```powershell
$env:EARN_TEST_BASE_URL = "http://localhost:$env:PORT"
node node_modules/@playwright/test/cli.js test --config=playwright.earn.config.cjs --grep 'overview desktop|overview mobile'
npm run typecheck
```

The latest overview pass ran only these two cases and one type check. The
desktop test's focus assertion was corrected to use real keyboard navigation;
its focused confirmation passed. See
`.impeccable/review/earn-overview-verification.md` for results and screenshots.
