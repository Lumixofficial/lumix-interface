"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AssetPairSelector,
  type AssetPairId,
  assetPairOptions,
} from "./asset-pair-selector";
import {
  OptionDetailDrawer,
  type OptionDrawerConfiguration,
  type OptionDrawerContract,
  type OptionDrawerRequest,
  type OptionOrderMode,
} from "./option-detail-drawer";
import {
  CURRENT_USER,
  PROTOCOL_FEE_RATE,
  availableOrdersForAction,
  availableWalletBalance,
  buildTheoreticalQuote,
  cancelOptionOrder,
  closeOptionPosition,
  createInitialMarketState,
  displayOrderStatus,
  formatNumber,
  getExpiration,
  marketConfigs,
  optionExpirations,
  recommendedStrike,
  shortenAddress,
  submitOptionOrder,
  type ExpirationId,
  type OptionOrder,
  type OptionPosition,
  type OptionSide,
  type OptionsMarketState,
  type OrderDraft,
  type OrderSide,
  type SubmissionResult,
} from "./options-market";
import { formatFinancial, formatInteger, formatSignedFinancial } from "./financial-format";
import { useWallet } from "./wallet-provider";
import { usePortfolioRecords } from "./use-portfolio-records";

type MobileSide = "calls" | "puts";
type ChainSide = {
  buyOrders: OptionOrder[];
  sellOrders: OptionOrder[];
  buyIv?: number;
  sellIv?: number;
};
type ChainRow = { strike: number; call: ChainSide; put: ChainSide };
type DrawerState = OptionDrawerRequest & {
  pairId: AssetPairId;
  side: OptionSide;
  strike: number;
  expirationId: ExpirationId;
};
type OrderFilter = "open" | "unfilled" | "history";

function createPublicMarketState(): OptionsMarketState {
  const initialState = createInitialMarketState();
  return {
    ...initialState,
    orders: initialState.orders.filter((order) => order.owner !== CURRENT_USER && order.recipient !== CURRENT_USER),
    fills: [],
    positions: [],
    notifications: [],
  };
}

function currentPriceMarker({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr className="options-current-price-row">
      <td colSpan={colSpan}><span>{label}</span></td>
    </tr>
  );
}

const CurrentPriceRow = currentPriceMarker;

function quoteImpliedVolatility(
  baseIv: number,
  order: OptionOrder | undefined,
  referencePremium: number,
  action: OrderSide,
) {
  if (!order || referencePremium <= 0) return undefined;
  const premiumSignal = (order.limitPremium / referencePremium) - 1;
  const sideAdjustment = action === "buy" ? 0.35 : -0.35;
  return Math.min(400, Math.max(1, baseIv + premiumSignal * 8 + sideAdjustment));
}

function useExpirationCountdown(timestamp: number) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [timestamp]);

  if (now === null) return "Calculating…";
  const remaining = Math.max(0, timestamp - now);
  if (remaining === 0) return "Expired";
  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

function MarketActionButton({
  action,
  optionSide,
  strike,
  strikeLabel,
  orders,
  quote,
  precision,
  impliedVolatility,
  selected,
  onSelect,
}: {
  action: OrderSide;
  optionSide: OptionSide;
  strike: number;
  strikeLabel: string;
  orders: OptionOrder[];
  quote: string;
  precision: number;
  impliedVolatility?: number;
  selected: boolean;
  onSelect: (action: OrderSide, side: OptionSide, strike: number, bestOrder?: OptionOrder) => void;
}) {
  const bestOrder = orders[0];
  const sideLabel = optionSide === "call" ? "Call" : "Put";
  const actionLabel = action === "buy" ? "Buy" : "Sell";
  const valueLabel = bestOrder ? formatNumber(bestOrder.limitPremium, precision) : "—";
  const ivLabel = impliedVolatility === undefined ? "IV unavailable" : `${formatNumber(impliedVolatility, 1)}% IV`;

  return (
    <button
      className={`option-quote-button option-quote-button--${action}${selected ? " is-selected" : ""}`}
      type="button"
      disabled={!bestOrder}
      aria-label={bestOrder
        ? `${actionLabel} ${sideLabel} at ${strikeLabel} strike for ${valueLabel} ${quote}, ${ivLabel}`
        : `No ${actionLabel.toLowerCase()} orders for ${sideLabel} at ${strikeLabel} strike. Use Create order to add one.`}
      aria-pressed={selected}
      onClick={() => bestOrder && onSelect(action, optionSide, strike, bestOrder)}
    >
      <span>{valueLabel}</span>
      {bestOrder && <small aria-hidden="true">{ivLabel}</small>}
    </button>
  );
}

function useLiveNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function formatDuration(milliseconds: number) {
  if (milliseconds <= 0) return "Expired";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function absoluteTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function shortDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function signedPercent(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : "\u2212"}${formatFinancial(Math.abs(value))}%`;
}

function valueTone(value: number) {
  if (Math.abs(value) < 0.005) return "is-neutral";
  return value > 0 ? "is-positive" : "is-negative";
}

function positionMetrics(position: OptionPosition) {
  const market = marketConfigs[position.pairId];
  const quote = buildTheoreticalQuote(market, position.strike, position.optionSide, position.expirationId);
  const mark = (quote.bid + quote.ask) / 2;
  const direction = position.direction === "long" ? 1 : -1;
  const pnl = (mark - position.premium) * position.quantity * direction;
  const grossPremium = position.premium * position.quantity;
  const tradeFee = grossPremium * PROTOCOL_FEE_RATE;
  const underlyingQuantity = market.contractSize * position.quantity;
  const effectivePremiumPerUnit = underlyingQuantity > 0
    ? (position.direction === "long" ? grossPremium + tradeFee : grossPremium - tradeFee) / underlyingQuantity
    : 0;
  const breakEven = position.optionSide === "call"
    ? position.strike + effectivePremiumPerUnit
    : Math.max(0, position.strike - effectivePremiumPerUnit);
  const denominator = position.direction === "long"
    ? position.premium * position.quantity
    : position.optionSide === "call"
      ? market.currentPrice * market.contractSize * position.quantity
      : position.strike * market.contractSize * position.quantity;
  const roi = denominator > 0 ? (pnl / denominator) * 100 : 0;
  return { market, mark, pnl, roi, breakEven };
}

function historyPositionMetrics(position: OptionPosition) {
  const market = marketConfigs[position.pairId];
  const exit = position.exitPremium ?? position.premium;
  const direction = position.direction === "long" ? 1 : -1;
  const pnl = (exit - position.premium) * position.quantity * direction;
  const denominator = position.direction === "long"
    ? position.premium * position.quantity
    : position.optionSide === "call"
      ? market.currentPrice * market.contractSize * position.quantity
      : position.strike * market.contractSize * position.quantity;
  return { market, exit, pnl, roi: denominator > 0 ? (pnl / denominator) * 100 : 0 };
}

function OptionIdentity({ pairId, strike, side, expirationId, now }: Pick<OptionPosition, "pairId" | "strike" | "expirationId"> & { side: OptionSide; now?: number }) {
  const market = marketConfigs[pairId];
  const expiration = getExpiration(expirationId);
  return (
    <div className="options-order-identity">
      <strong>{market.base} {formatNumber(strike, market.strikePrecision)} {side === "call" ? "Call" : "Put"}</strong>
      <small>{market.base} / {market.quote}</small>
      <small>{expiration.label}{now === undefined ? "" : `, ${formatDuration(expiration.timestamp - now)} remaining`}</small>
    </div>
  );
}

function MyOrders({
  state,
  onCancel,
  onEdit,
  onClosePosition,
}: {
  state: OptionsMarketState;
  onCancel: (orderId: string) => void;
  onEdit: (order: OptionOrder) => void;
  onClosePosition: (position: OptionPosition) => void;
}) {
  const [filter, setFilter] = useState<OrderFilter>("open");
  const now = useLiveNow();
  const openPositions = state.positions
    .filter((position) => position.status === "open")
    .sort((left, right) => right.openedAt - left.openedAt);
  const unfilledOrders = state.orders
    .filter((order) => order.owner === CURRENT_USER && displayOrderStatus(order, now) === "open")
    .sort((left, right) => right.createdAt - left.createdAt);
  const closedPositions = state.positions
    .filter((position) => position.status !== "open")
    .sort((left, right) => (right.closedAt ?? right.openedAt) - (left.closedAt ?? left.openedAt));
  const inactiveOrders = state.orders
    .filter((order) => order.owner === CURRENT_USER && order.status !== "filled" && displayOrderStatus(order, now) === "cancelled")
    .sort((left, right) => (right.cancelledAt ?? right.expiresAt) - (left.cancelledAt ?? left.expiresAt));
  const historyCount = closedPositions.length + inactiveOrders.length;
  const countLabel = filter === "open"
    ? `${openPositions.length} open ${openPositions.length === 1 ? "position" : "positions"}`
    : filter === "unfilled"
      ? `${unfilledOrders.length} unfilled ${unfilledOrders.length === 1 ? "order" : "orders"}`
      : `${historyCount} historical ${historyCount === 1 ? "trade" : "trades"}`;

  return (
    <section className="options-my-orders" aria-labelledby="my-orders-title">
      <div className="options-my-orders-heading">
        <h2 id="my-orders-title">My orders</h2>
        <span aria-live="polite">{countLabel}</span>
      </div>

      <div className="trade-segmented options-order-filters" role="tablist" aria-label="My orders">
        {(["open", "unfilled", "history"] as const).map((id) => (
          <button type="button" role="tab" aria-selected={filter === id} key={id} onClick={() => setFilter(id)}>
            {id === "open" ? "Open" : id === "unfilled" ? "Unfilled" : "History"}
          </button>
        ))}
      </div>

      {filter === "unfilled" && (
        <p className="options-reservation-note">Unused reservations release when an order is cancelled or expires.</p>
      )}

      {filter === "open" && (openPositions.length ? (
        <div className="trade-table-wrap options-orders-table-wrap">
          <table className="trade-table options-orders-table options-positions-table">
            <caption className="trade-sr-only">Your open option positions</caption>
            <thead><tr><th>Options</th><th>Side</th><th>Counterparty</th><th className="is-numeric">Size</th><th className="is-numeric">Breakeven</th><th className="is-numeric">Mark</th><th className="is-numeric">Unrealized P&amp;L</th><th className="is-numeric">ROI</th><th>Status</th><th className="is-center">Actions</th></tr></thead>
            <tbody>{openPositions.map((position) => {
              const { market: selectedMarket, mark, pnl, roi, breakEven } = positionMetrics(position);
              const side = position.direction === "long" ? "buy" : "sell";
              return (
                <tr key={position.id}>
                  <td data-label="Options"><OptionIdentity {...position} side={position.optionSide} now={now} /></td>
                  <td data-label="Side"><span className={`option-order-side option-order-side--${side}`}>{side}</span></td>
                  <td data-label="Counterparty"><span className="trade-number">{shortenAddress(position.counterparty)}</span></td>
                  <td className="is-numeric" data-label="Size">{formatInteger(position.quantity)}</td>
                  <td className="is-numeric option-position-breakeven" data-label="Breakeven">{formatFinancial(breakEven)} {selectedMarket.quote}</td>
                  <td className="is-numeric" data-label="Mark">{formatFinancial(mark)} {selectedMarket.quote}</td>
                  <td className={`is-numeric option-performance ${valueTone(pnl)}`} data-label="Unrealized P&amp;L">{formatSignedFinancial(pnl)} {selectedMarket.quote}</td>
                  <td className={`is-numeric option-performance ${valueTone(roi)}`} data-label="ROI">{signedPercent(roi)}</td>
                  <td data-label="Status"><span className="option-order-status option-order-status--open">Open</span></td>
                  <td className="options-order-actions"><button type="button" onClick={() => onClosePosition(position)}>View details</button><button type="button" onClick={() => onClosePosition(position)}>{position.direction === "long" ? "Sell position" : "Buy to close"}</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <div className="options-orders-empty"><strong>No open positions</strong></div>)}

      {filter === "unfilled" && (unfilledOrders.length ? (
        <div className="trade-table-wrap options-orders-table-wrap">
          <table className="trade-table options-orders-table options-unfilled-table">
            <caption className="trade-sr-only">Your unfilled option orders</caption>
            <thead><tr><th>Options</th><th>Side</th><th className="is-numeric">Premium</th><th className="is-numeric">Size</th><th>Opened</th><th>Status</th><th className="is-center">Actions</th></tr></thead>
            <tbody>{unfilledOrders.map((order) => {
              const selectedMarket = marketConfigs[order.pairId];
              return (
                <tr key={order.id}>
                  <td data-label="Options"><OptionIdentity pairId={order.pairId} strike={order.strike} side={order.optionSide} expirationId={order.expirationId} /></td>
                  <td data-label="Side"><span className={`option-order-side option-order-side--${order.orderSide}`}>{order.orderSide}</span></td>
                  <td className="is-numeric" data-label="Premium">{formatFinancial(order.limitPremium)} {selectedMarket.quote}</td>
                  <td className="is-numeric" data-label="Size">{formatInteger(order.remainingQuantity)}</td>
                  <td data-label="Opened"><time dateTime={new Date(order.createdAt).toISOString()} title={absoluteTimestamp(order.createdAt)} aria-label={`Opened ${absoluteTimestamp(order.createdAt)}`}>{formatDuration(now - order.createdAt).replace("Expired", "0h 0m")}</time></td>
                  <td data-label="Status"><span className="option-order-status option-order-status--waiting">Waiting</span></td>
                  <td className="options-order-actions"><button type="button" onClick={() => onEdit(order)}>Edit</button><button className="is-negative" type="button" onClick={() => onCancel(order.id)}>Cancel</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <div className="options-orders-empty"><strong>No unfilled orders</strong></div>)}

      {filter === "history" && (historyCount ? (
        <div className="trade-table-wrap options-orders-table-wrap">
          <table className="trade-table options-orders-table options-history-table">
            <caption className="trade-sr-only">Your option trade history</caption>
            <thead><tr><th>Options</th><th>Side</th><th className="is-numeric">Size</th><th>Opened</th><th>Closed / settled</th><th className="is-numeric">Entry premium</th><th className="is-numeric">Exit / settlement</th><th className="is-numeric">Realized P&amp;L</th><th className="is-numeric">ROI</th><th>Status</th></tr></thead>
            <tbody>
              {[...closedPositions.map((position) => ({ kind: "position" as const, at: position.closedAt ?? position.openedAt, position })), ...inactiveOrders.map((order) => ({ kind: "order" as const, at: order.status === "open" && order.expiresAt <= now ? order.expiresAt : order.cancelledAt ?? order.createdAt, order }))]
                .sort((left, right) => right.at - left.at)
                .map((record) => {
                  if (record.kind === "order") {
                    const order = record.order;
                    const expired = order.status === "open" && order.expiresAt <= now;
                    return <tr key={order.id}><td data-label="Options"><OptionIdentity pairId={order.pairId} strike={order.strike} side={order.optionSide} expirationId={order.expirationId} /></td><td data-label="Side"><span className={`option-order-side option-order-side--${order.orderSide}`}>{order.orderSide}</span></td><td className="is-numeric" data-label="Size">{formatInteger(order.quantity)}</td><td data-label="Opened"><time dateTime={new Date(order.createdAt).toISOString()} title={absoluteTimestamp(order.createdAt)}>{shortDate(order.createdAt)}</time></td><td data-label="Closed / settled" title={expired ? absoluteTimestamp(order.expiresAt) : "Cancelled before execution"}>{expired ? shortDate(order.expiresAt) : "Not executed"}</td><td className="is-numeric" data-label="Entry premium">{formatFinancial(order.limitPremium)} {marketConfigs[order.pairId].quote}</td><td className="is-numeric" data-label="Exit / settlement">—</td><td className="is-numeric" data-label="Realized P&amp;L">—</td><td className="is-numeric" data-label="ROI">—</td><td data-label="Status"><span className="option-order-status option-order-status--cancelled">{expired ? "Expired" : "Cancelled"}</span></td></tr>;
                  }
                  const position = record.position;
                  const { market: selectedMarket, exit, pnl, roi } = historyPositionMetrics(position);
                  const side = position.direction === "long" ? "buy" : "sell";
                  return <tr key={position.id}><td data-label="Options"><OptionIdentity {...position} side={position.optionSide} /></td><td data-label="Side"><span className={`option-order-side option-order-side--${side}`}>{side}</span></td><td className="is-numeric" data-label="Size">{formatInteger(position.quantity)}</td><td data-label="Opened" title={absoluteTimestamp(position.openedAt)}>{shortDate(position.openedAt)}</td><td data-label="Closed / settled" title={absoluteTimestamp(position.closedAt ?? position.openedAt)}>{shortDate(position.closedAt ?? position.openedAt)}</td><td className="is-numeric" data-label="Entry premium">{formatFinancial(position.premium)} {selectedMarket.quote}</td><td className="is-numeric" data-label="Exit / settlement">{formatFinancial(exit)} {selectedMarket.quote}</td><td className={`is-numeric option-performance ${valueTone(pnl)}`} data-label="Realized P&amp;L">{formatSignedFinancial(pnl)} {selectedMarket.quote}</td><td className={`is-numeric option-performance ${valueTone(roi)}`} data-label="ROI">{signedPercent(roi)}</td><td data-label="Status"><span className="option-order-status option-order-status--filled">{position.status === "settled" ? "Settled" : "Closed"}</span></td></tr>;
                })}
            </tbody>
          </table>
        </div>
      ) : <div className="options-orders-empty"><strong>No trade history yet</strong></div>)}
    </section>
  );
}

function WalletOrdersGate({ isConnecting, isReady, onConnect }: { isConnecting: boolean; isReady: boolean; onConnect: () => void }) {
  return (
    <section className="options-my-orders wallet-private-gate" aria-labelledby="my-orders-title">
      <div className="options-my-orders-heading"><h2 id="my-orders-title">My orders</h2></div>
      <div className="wallet-private-gate-content">
        <strong>Connect your wallet to view positions and orders</strong>
        <span>Private trading activity stays hidden until authentication succeeds.</span>
        <button className="trade-button trade-button--primary wallet-connect-button" type="button" disabled={!isReady || isConnecting} onClick={onConnect}>
          {isConnecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    </section>
  );
}

export function OptionsWorkspace() {
  const { address, balanceStatus, balances, connect, isAuthenticated, isConnecting, isReady, refreshBalances } = useWallet();
  const [pairId, setPairId] = useState<AssetPairId>(assetPairOptions[0].id);
  const [expirationId, setExpirationId] = useState<ExpirationId>(optionExpirations[0].id);
  const [mobileSide, setMobileSide] = useState<MobileSide>("calls");
  const history = usePortfolioRecords(isAuthenticated ? address : undefined);
  const publicMarket = useMemo(() => createPublicMarketState(), []);
  const marketState = history.data?.options ?? publicMarket;
  const setMarketState = (next: OptionsMarketState) => history.update((current) => ({ ...current, options: next }));
  const [drawerState, setDrawerState] = useState<DrawerState>();
  const [drawerClosing, setDrawerClosing] = useState(false);
  const market = marketConfigs[pairId];
  const expiration = getExpiration(expirationId);
  const expirationCountdown = useExpirationCountdown(expiration.timestamp);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalidate wallet-specific drawer state when the external wallet session changes.
    setDrawerState(undefined);
    setDrawerClosing(false);
  }, [address, isAuthenticated]);

  const chain = useMemo<ChainRow[]>(() => market.strikes.map((strike) => {
    const makeSide = (optionSide: OptionSide): ChainSide => {
      const theoretical = buildTheoreticalQuote(market, strike, optionSide, expirationId);
      const buyOrders = availableOrdersForAction(marketState.orders, { pairId, optionSide, strike, expirationId, orderSide: "buy" });
      const sellOrders = availableOrdersForAction(marketState.orders, { pairId, optionSide, strike, expirationId, orderSide: "sell" });
      return {
        buyOrders,
        sellOrders,
        buyIv: quoteImpliedVolatility(theoretical.iv, buyOrders[0], theoretical.ask, "buy"),
        sellIv: quoteImpliedVolatility(theoretical.iv, sellOrders[0], theoretical.bid, "sell"),
      };
    };
    return { strike, call: makeSide("call"), put: makeSide("put") };
  }), [expirationId, market, marketState.orders, pairId]);

  const markerIndex = chain.findIndex((row) => row.strike > market.currentPrice);
  const currentPrice = formatNumber(market.currentPrice, market.pricePrecision);
  const markerLabel = `Current price: ${currentPrice} ${market.quote}`;
  const chainTitle = `${market.base} / ${market.quote} options chain`;

  const drawerContract = useMemo<OptionDrawerContract | null>(() => {
    if (!drawerState) return null;
    const selectedMarket = marketConfigs[drawerState.pairId];
    const selectedExpiration = getExpiration(drawerState.expirationId);
    const quote = buildTheoreticalQuote(selectedMarket, drawerState.strike, drawerState.side, drawerState.expirationId);
    return {
      pairId: drawerState.pairId,
      base: selectedMarket.base,
      quote: selectedMarket.quote,
      currentPrice: selectedMarket.currentPrice,
      strike: drawerState.strike,
      iv: quote.iv,
      side: drawerState.side,
      expirationId: drawerState.expirationId,
      expirationLabel: selectedExpiration.fullLabel,
      timeRemaining: selectedExpiration.timeRemaining,
      pricePrecision: selectedMarket.pricePrecision,
      strikePrecision: selectedMarket.strikePrecision,
      premiumPrecision: selectedMarket.premiumPrecision,
      contractSize: selectedMarket.contractSize,
      availableBaseBalance: availableWalletBalance(marketState.orders, selectedMarket.base, drawerState.replaceOrderId, balances),
      availableQuoteBalance: availableWalletBalance(marketState.orders, selectedMarket.quote, drawerState.replaceOrderId, balances),
    };
  }, [balances, drawerState, marketState.orders]);

  function makeRequestKey(prefix: string) {
    return `${prefix}-${marketState.sequence}-${Date.now()}`;
  }

  function showDrawer(next: DrawerState) {
    setDrawerClosing(false);
    setDrawerState(next);
  }

  function selectMarketAction(action: OrderSide, side: OptionSide, strike: number, bestOrder?: OptionOrder) {
    if (!bestOrder) return;
    if (!isAuthenticated) {
      void connect();
      return;
    }
    if (balanceStatus !== "success") return;
    showDrawer({
      source: "chain",
      action,
      intent: "take",
      targetOrderId: bestOrder.id,
      initialPremium: bestOrder.limitPremium,
      requestKey: makeRequestKey("chain"),
      pairId,
      side,
      strike,
      expirationId,
    });
  }

  function openCreateOrder() {
    if (!isAuthenticated) {
      void connect();
      return;
    }
    if (balanceStatus !== "success") return;
    showDrawer({
      source: "create",
      action: "buy",
      intent: "limit",
      requestKey: makeRequestKey("create"),
      pairId,
      side: "call",
      strike: recommendedStrike(market),
      expirationId,
    });
  }

  function changeDrawerAction(action: OptionOrderMode, strike?: number) {
    setDrawerState((current) => {
      if (!current) return current;
      if (current.source === "position" || current.source === "adjust") return current;
      if (current.source !== "chain") {
        return {
          ...current,
          action,
          strike: strike ?? current.strike,
          intent: current.source === "counter" ? "counter" : "limit",
          requestKey: makeRequestKey("compose-side"),
        };
      }
      const available = availableOrdersForAction(marketState.orders, {
        pairId: current.pairId,
        optionSide: current.side,
        strike: current.strike,
        expirationId: current.expirationId,
        orderSide: action,
      });
      const best = available[0];
      return {
        ...current,
        action,
        strike: strike ?? current.strike,
        intent: best ? "take" : "limit",
        targetOrderId: best?.id,
        initialPremium: best?.limitPremium ?? current.initialPremium,
        requestKey: makeRequestKey("side"),
      };
    });
  }

  function changeDrawerConfiguration(change: OptionDrawerConfiguration) {
    setDrawerState((current) => {
      if (!current) return current;
      const nextPairId = change.pairId ?? current.pairId;
      const nextMarket = marketConfigs[nextPairId];
      const nextStrike = change.strike ?? (change.pairId
        ? recommendedStrike(nextMarket)
        : current.strike);
      return {
        ...current,
        ...change,
        pairId: nextPairId,
        strike: nextStrike,
        intent: "limit",
        targetOrderId: undefined,
        initialPremium: undefined,
        requestKey: makeRequestKey("configure"),
      };
    });
  }

  function changePair(nextPairId: AssetPairId) {
    setDrawerClosing(false);
    setPairId(nextPairId);
    setDrawerState(undefined);
  }

  function changeExpiration(nextExpirationId: ExpirationId) {
    setDrawerClosing(false);
    setExpirationId(nextExpirationId);
    setDrawerState(undefined);
  }

  function handleSubmit(draft: OrderDraft, replaceOrderId?: string): SubmissionResult {
    if (history.status !== "ready") return { state: marketState, ok: false, filledQuantity: 0, remainingQuantity: draft.quantity, message: "History is unavailable. Please retry before placing an order." };
    if (draft.closePositionId) {
      const result = closeOptionPosition(marketState, draft.closePositionId, draft.limitPremium, draft.quantity);
      if (result.ok && !setMarketState(result.state)) return { ...result, ok: false, message: "Activity could not be saved. Retry loading history before continuing." };
      if (result.ok) void refreshBalances();
      return result;
    }
    const workingState = replaceOrderId
      ? cancelOptionOrder(marketState, replaceOrderId)
      : marketState;
    const result = submitOptionOrder(workingState, draft, balances);
    if (result.ok && !setMarketState(result.state)) return { ...result, ok: false, message: "Activity could not be saved. Retry loading history before continuing." };
    if (!result.ok) return { ...result, state: marketState };
    void refreshBalances();
    return result;
  }

  function cancelOrder(orderId: string) {
    const next = cancelOptionOrder(marketState, orderId);
    setMarketState(next);
  }

  function openAdjustment(order: OptionOrder) {
    showDrawer({
      source: "adjust",
      action: order.orderSide,
      intent: "limit",
      initialPremium: order.limitPremium,
      initialQuantity: order.remainingQuantity,
      replaceOrderId: order.id,
      requestKey: makeRequestKey("adjust"),
      pairId: order.pairId,
      side: order.optionSide,
      strike: order.strike,
      expirationId: order.expirationId,
    });
  }

  function openPositionClose(position: OptionPosition) {
    const action: OrderSide = position.direction === "long" ? "sell" : "buy";
    const available = availableOrdersForAction(marketState.orders, {
      pairId: position.pairId,
      optionSide: position.optionSide,
      strike: position.strike,
      expirationId: position.expirationId,
      orderSide: action,
    });
    const selectedMarket = marketConfigs[position.pairId];
    const theoretical = buildTheoreticalQuote(selectedMarket, position.strike, position.optionSide, position.expirationId);
    showDrawer({
      source: "position",
      action,
      intent: "take",
      targetOrderId: available[0]?.id,
      initialPremium: available[0]?.limitPremium ?? (action === "buy" ? theoretical.ask : theoretical.bid),
      initialQuantity: position.quantity,
      maximumQuantity: position.quantity,
      positionId: position.id,
      requestKey: makeRequestKey("position"),
      pairId: position.pairId,
      side: position.optionSide,
      strike: position.strike,
      expirationId: position.expirationId,
    });
  }

  const closeDrawer = useCallback(() => {
    setDrawerClosing(true);
  }, []);

  const finishDrawerClose = useCallback(() => {
    setDrawerState(undefined);
    setDrawerClosing(false);
  }, []);
  const isSelected = (action: OrderSide, side: OptionSide, strike: number) => Boolean(
    drawerState?.source === "chain"
    && drawerState.action === action
    && drawerState.side === side
    && drawerState.strike === strike
    && drawerState.pairId === pairId
    && drawerState.expirationId === expirationId,
  );

  return (
    <>
      {history.status === "error" && <p role="alert">History could not be loaded or saved. <button type="button" onClick={history.reload}>Retry</button></p>}
      <header className="options-page-header">
        <div className="options-title-block">
          <h1>Options</h1>
          <p>Peer-to-peer European-style options</p>
        </div>
        <dl className="options-market-summary">
          <div className="options-market-pair">
            <dt>Underlying market</dt>
            <dd><AssetPairSelector label="Underlying market" value={pairId} onChange={changePair} /></dd>
          </div>
          <div>
            <dt>Current price</dt>
            <dd className="trade-number options-current-price-value">{market.base} - ${currentPrice}</dd>
          </div>
        </dl>
      </header>

      <section className="options-expiration-bar" aria-labelledby="expiration-title">
        <div className="options-expiration-copy">
          <strong id="expiration-title">Option expiration:</strong>
          <span>{expirationCountdown}</span>
        </div>
        <div className="trade-segmented options-expiration-options" role="radiogroup" aria-label="Option expiration date">
          {optionExpirations.map((item) => (
            <button type="button" role="radio" aria-checked={item.id === expirationId} key={item.id} onClick={() => changeExpiration(item.id)}>{item.label}</button>
          ))}
        </div>
      </section>

      <div className="options-market-toolbar">
        <div><strong>Peer-to-peer order book</strong><span>Automatic matching with price and time priority</span></div>
        <button
          className={`trade-button trade-button--primary${!isAuthenticated ? " wallet-connect-button" : ""}`}
          type="button"
          disabled={isAuthenticated && balanceStatus !== "success"}
          onClick={openCreateOrder}
        >
          {!isAuthenticated ? (isConnecting ? "Connecting…" : "Connect wallet") : balanceStatus === "loading" ? "Loading wallet…" : "Create order"}
        </button>
      </div>

      <section className="options-chain-panel" aria-labelledby="options-chain-title">
        <div className="options-chain-heading">
          <div><h2 id="options-chain-title">{chainTitle}</h2><p>User-priced premiums in {market.quote}</p></div>
        </div>

        <div className="options-desktop-chain trade-table-wrap">
          <table className="trade-table options-table">
            <caption className="trade-sr-only">{market.base} Call and Put Buy and Sell premiums by strike for {expiration.fullLabel}</caption>
            <colgroup><col span={3} /><col className="options-strike-column" /><col span={3} /></colgroup>
            <thead>
              <tr className="options-group-row">
                <th className="options-call-heading" scope="colgroup" colSpan={3}>Calls</th>
                <th className="options-strike-heading" scope="col" rowSpan={2}>Strike <span>{market.quote}</span></th>
                <th className="options-put-heading" scope="colgroup" colSpan={3}>Puts</th>
              </tr>
              <tr>
                <th className="is-numeric option-quote-heading" scope="col">Sell</th><th className="is-numeric option-quote-heading" scope="col">Buy</th><th className="is-numeric" scope="col">Distance</th>
                <th className="is-numeric" scope="col">Distance</th><th className="is-numeric option-quote-heading" scope="col">Sell</th><th className="is-numeric option-quote-heading" scope="col">Buy</th>
              </tr>
            </thead>
            <tbody>
              {chain.map((row, index) => {
                const strikeLabel = formatNumber(row.strike, market.strikePrecision);
                const distanceLabel = formatNumber(Math.abs(row.strike - market.currentPrice), market.pricePrecision);
                return (
                  <Fragment key={row.strike}>
                    {index === markerIndex && <CurrentPriceRow colSpan={7} label={markerLabel} />}
                    <tr>
                      <td className="option-quote-cell"><MarketActionButton action="sell" optionSide="call" strike={row.strike} strikeLabel={strikeLabel} orders={row.call.sellOrders} quote={market.quote} precision={market.premiumPrecision} impliedVolatility={row.call.sellIv} selected={isSelected("sell", "call", row.strike)} onSelect={selectMarketAction} /></td>
                      <td className="option-quote-cell"><MarketActionButton action="buy" optionSide="call" strike={row.strike} strikeLabel={strikeLabel} orders={row.call.buyOrders} quote={market.quote} precision={market.premiumPrecision} impliedVolatility={row.call.buyIv} selected={isSelected("buy", "call", row.strike)} onSelect={selectMarketAction} /></td>
                      <td className="is-numeric option-distance">{distanceLabel}</td>
                      <th className="trade-strike options-strike-cell" scope="row"><span className="trade-number">{strikeLabel}</span></th>
                      <td className="is-numeric option-distance">{distanceLabel}</td>
                      <td className="option-quote-cell"><MarketActionButton action="sell" optionSide="put" strike={row.strike} strikeLabel={strikeLabel} orders={row.put.sellOrders} quote={market.quote} precision={market.premiumPrecision} impliedVolatility={row.put.sellIv} selected={isSelected("sell", "put", row.strike)} onSelect={selectMarketAction} /></td>
                      <td className="option-quote-cell"><MarketActionButton action="buy" optionSide="put" strike={row.strike} strikeLabel={strikeLabel} orders={row.put.buyOrders} quote={market.quote} precision={market.premiumPrecision} impliedVolatility={row.put.buyIv} selected={isSelected("buy", "put", row.strike)} onSelect={selectMarketAction} /></td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="options-mobile-chain">
          <div className="trade-segmented options-side-toggle" role="group" aria-label="Option type">
            <button type="button" aria-pressed={mobileSide === "calls"} onClick={() => setMobileSide("calls")}>Calls</button>
            <button type="button" aria-pressed={mobileSide === "puts"} onClick={() => setMobileSide("puts")}>Puts</button>
          </div>
          <div className="trade-table-wrap options-mobile-table-wrap">
            <table className={`trade-table options-mobile-table options-mobile-table--${mobileSide}`}>
              <caption className="trade-sr-only">{mobileSide === "calls" ? "Call" : "Put"} Buy and Sell premiums by strike for {expiration.fullLabel}</caption>
              <thead><tr><th className="is-numeric">Strike</th><th className="is-numeric">Distance</th><th className="is-numeric option-quote-heading">Sell</th><th className="is-numeric option-quote-heading">Buy</th></tr></thead>
              <tbody>
                {chain.map((row, index) => {
                  const side: OptionSide = mobileSide === "calls" ? "call" : "put";
                  const data = row[side];
                  const strikeLabel = formatNumber(row.strike, market.strikePrecision);
                  const distanceLabel = formatNumber(Math.abs(row.strike - market.currentPrice), market.pricePrecision);
                  return (
                    <Fragment key={row.strike}>
                      {index === markerIndex && <CurrentPriceRow colSpan={4} label={markerLabel} />}
                      <tr>
                        <th className="trade-strike options-strike-cell" scope="row"><span className="trade-number">{strikeLabel}</span></th>
                        <td className="is-numeric option-distance">{distanceLabel}</td>
                        <td className="option-quote-cell"><MarketActionButton action="sell" optionSide={side} strike={row.strike} strikeLabel={strikeLabel} orders={data.sellOrders} quote={market.quote} precision={market.premiumPrecision} impliedVolatility={data.sellIv} selected={isSelected("sell", side, row.strike)} onSelect={selectMarketAction} /></td>
                        <td className="option-quote-cell"><MarketActionButton action="buy" optionSide={side} strike={row.strike} strikeLabel={strikeLabel} orders={data.buyOrders} quote={market.quote} precision={market.premiumPrecision} impliedVolatility={data.buyIv} selected={isSelected("buy", side, row.strike)} onSelect={selectMarketAction} /></td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {isAuthenticated ? (
        <MyOrders state={marketState} onCancel={cancelOrder} onEdit={openAdjustment} onClosePosition={openPositionClose} />
      ) : (
        <WalletOrdersGate isConnecting={isConnecting} isReady={isReady} onConnect={() => void connect()} />
      )}

      <OptionDetailDrawer
        open={Boolean(drawerState) && !drawerClosing}
        closing={drawerClosing}
        contract={drawerContract}
        request={drawerState ?? null}
        orders={marketState.orders}
        onActionChange={changeDrawerAction}
        onConfigurationChange={changeDrawerConfiguration}
        onSubmit={handleSubmit}
        onClose={closeDrawer}
        onExitComplete={finishDrawerClose}
      />
    </>
  );
}
