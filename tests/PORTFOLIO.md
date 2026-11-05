# Portfolio verification

Run `npm run test:portfolio`, `npm run typecheck`, and `npm run build`.

The pure tests cover fee treatment, outcome eligibility, date boundaries,
deduplication, partial Options closes, account/network validation, corrupted
storage, and confirmed-payment receipt recovery (including refresh and quota errors).

For browser checks, start the app on any port and set `LUMIX_TEST_ORIGIN` to its
HTTP(S) origin (or export its `PORT`). Start Chrome
with a **separate disposable profile** and `--remote-debugging-port=9239`.
Open `/portfolio` in that browser before running:

```text
node tests/portfolio-browser.cjs
node tests/portfolio-browser.cjs --sources
```

The browser harness supplies a mocked wallet through React's development fiber
state and writes explicitly synthetic fixtures to that isolated profile. It must
not run against a real user's browser. It does not request signatures or send
transactions. Screenshots under `.impeccable/review/portfolio-*.png` are QA fixtures,
not evidence of actual earnings. Fiber injection may need updating after a React
upgrade.

Checks cover both themes at desktop/mobile sizes, controlled table scrolling,
pagination, independent chart/history selections, wallet changes/disconnection,
refresh persistence, empty/error/retry states, and testnet explorer URLs.
Source-flow checks complete a Spot preview, cancel an Options order, remove a
Perpetuals position while retaining its receipt, and verify that unreadable
history blocks another payment.

## Data limits

- Spot and Options currently use local preview flows, not on-chain executions.
  Portfolio labels these records as previews; it does not claim actual swaps or
  realized trade profit. The Spot source provides USD fee estimates and an XLM
  network fee; they retain their original units.
- Perpetuals confirms testnet margin payments, not settled derivative trades.
  Payments have transaction receipts but no realized P&L.
- No current producer supplies verified realized trade outcomes. The chart stays
  empty until a genuine outcome integration supplies recorded net P&L, or gross
  P&L plus recorded fees. Deposits, principal, previews and current-price marks
  are not outcome sources.
- History begins with activity captured by the new persistence layer. Previously
  discarded in-memory sessions cannot be recovered. Browser-local history is
  scoped by wallet and testnet, but is not cross-device or an authoritative ledger.
- Confirmed receipts have an independent recovery journal. Corrupt history is
  never silently overwritten. If the browser denies every storage write, a
  receipt remains in session memory until Retry succeeds; closing that session
  before storage recovers cannot preserve it.
