import type { AssetPairId } from "./asset-pair-selector";
import { formatFinancial } from "./financial-format";

export const CURRENT_USER = "GBCX7Q2L-LUMIX";
export const PROTOCOL_FEE_RATE = 0.003;
export const SETTLEMENT_TERMS = "automatic-net" as const;

export const optionExpirations = [
  { id: "30-oct", label: "30 Oct", fullLabel: "30 October 2026", timeRemaining: "48d 8h", timestamp: Date.UTC(2026, 9, 30, 16, 0, 0), premiumFactor: 1, ivShift: 0 },
  { id: "27-nov", label: "27 Nov", fullLabel: "27 November 2026", timeRemaining: "76d 8h", timestamp: Date.UTC(2026, 10, 27, 16, 0, 0), premiumFactor: 1.16, ivShift: 2.8 },
  { id: "18-dec", label: "18 Dec", fullLabel: "18 December 2026", timeRemaining: "97d 8h", timestamp: Date.UTC(2026, 11, 18, 16, 0, 0), premiumFactor: 1.31, ivShift: 4.6 },
] as const;

export type ExpirationId = (typeof optionExpirations)[number]["id"];
export type OptionSide = "call" | "put";
export type OrderSide = "buy" | "sell";
export type OrderStatus = "open" | "filled" | "cancelled";
export type OrderIntent = "take" | "limit" | "counter";
export type OrderExpiryId = "15m" | "1h" | "day";

export type MarketConfig = {
  id: AssetPairId;
  base: "XLM" | "BTC" | "ETH";
  quote: "USDC";
  currentPrice: number;
  pricePrecision: number;
  strikePrecision: number;
  premiumPrecision: number;
  contractSize: number;
  baseIv: number;
  strikes: readonly number[];
};

export type TheoreticalQuote = { bid: number; ask: number; iv: number };

export type OptionOrder = {
  id: string;
  owner: string;
  pairId: AssetPairId;
  optionSide: OptionSide;
  orderSide: OrderSide;
  strike: number;
  expirationId: ExpirationId;
  contractSize: number;
  settlementTerms: typeof SETTLEMENT_TERMS;
  limitPremium: number;
  quantity: number;
  remainingQuantity: number;
  createdAt: number;
  expiresAt: number;
  status: OrderStatus;
  cancelledAt?: number;
  linkedOrderId?: string;
  recipient?: string;
};

export type OptionFill = {
  id: string;
  makerOrderId: string;
  takerOrderId: string;
  pairId: AssetPairId;
  optionSide: OptionSide;
  strike: number;
  expirationId: ExpirationId;
  premium: number;
  quantity: number;
  createdAt: number;
};

export type PositionStatus = "open" | "closed" | "settled";

export type OptionPosition = {
  id: string;
  fillId: string;
  pairId: AssetPairId;
  optionSide: OptionSide;
  direction: "long" | "short";
  strike: number;
  expirationId: ExpirationId;
  quantity: number;
  premium: number;
  counterparty: string;
  openedAt: number;
  status: PositionStatus;
  closedAt?: number;
  exitPremium?: number;
};

export type MarketNotification = {
  id: string;
  message: string;
  createdAt: number;
};

export type OptionsMarketState = {
  orders: OptionOrder[];
  fills: OptionFill[];
  positions: OptionPosition[];
  notifications: MarketNotification[];
  sequence: number;
};

export type OrderDraft = {
  pairId: AssetPairId;
  optionSide: OptionSide;
  orderSide: OrderSide;
  strike: number;
  expirationId: ExpirationId;
  limitPremium: number;
  quantity: number;
  orderExpiryId: OrderExpiryId;
  intent: OrderIntent;
  linkedOrderId?: string;
  closePositionId?: string;
};

export type MarketSuggestion = {
  premium: number;
  availableQuantity: number;
  message: string;
};

export type SubmissionResult = {
  state: OptionsMarketState;
  ok: boolean;
  orderId?: string;
  filledQuantity: number;
  remainingQuantity: number;
  averagePremium?: number;
  suggestion?: MarketSuggestion;
  message: string;
};

export const marketConfigs: Record<AssetPairId, MarketConfig> = {
  "XLM-USDC": {
    id: "XLM-USDC",
    base: "XLM",
    quote: "USDC",
    currentPrice: 0.2502,
    pricePrecision: 4,
    strikePrecision: 4,
    premiumPrecision: 4,
    contractSize: 1,
    baseIv: 60.8,
    strikes: [0.18, 0.20, 0.22, 0.24, 0.25, 0.26, 0.28, 0.30, 0.32],
  },
  "BTC-USDC": {
    id: "BTC-USDC",
    base: "BTC",
    quote: "USDC",
    currentPrice: 112480.35,
    pricePrecision: 2,
    strikePrecision: 2,
    premiumPrecision: 2,
    contractSize: 1,
    baseIv: 54.6,
    strikes: [90000, 95000, 100000, 105000, 110000, 115000, 120000, 125000, 130000],
  },
  "ETH-USDC": {
    id: "ETH-USDC",
    base: "ETH",
    quote: "USDC",
    currentPrice: 4325.80,
    pricePrecision: 2,
    strikePrecision: 2,
    premiumPrecision: 2,
    contractSize: 1,
    baseIv: 58.9,
    strikes: [3600, 3800, 4000, 4200, 4300, 4400, 4600, 4800, 5000],
  },
};

export const walletBalances: Record<string, number> = {
  USDC: 3122,
  XLM: 12480.83,
  BTC: 0.084,
  ETH: 1.72,
};

export const orderExpiryOptions: ReadonlyArray<{ id: OrderExpiryId; label: string; milliseconds: number }> = [
  { id: "15m", label: "15 min", milliseconds: 15 * 60 * 1000 },
  { id: "1h", label: "1 hour", milliseconds: 60 * 60 * 1000 },
  { id: "day", label: "End of day", milliseconds: 8 * 60 * 60 * 1000 },
];

const makerAddresses = [
  "GB7YQ4QFQ4S3M2XL",
  "GDT4WN6PP9V8L3RT",
  "GA5K2X9NC8QM7JHF",
  "GCR8P5TY2MW6V4DA",
  "GAX3R7NK9PV2D6ME",
];

const INITIAL_MARKET_EPOCH = Date.UTC(2026, 8, 12, 12, 0, 0);

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value: number, precision: number) {
  void precision;
  return formatFinancial(value);
}

export function recommendedStrike(market: MarketConfig) {
  return market.strikes.reduce((closest, strike) => (
    Math.abs(strike - market.currentPrice) < Math.abs(closest - market.currentPrice) ? strike : closest
  ));
}

export function validateOptionStrike(market: MarketConfig, strike: number) {
  if (!Number.isFinite(strike) || strike <= 0) return "Enter a strike price greater than zero.";
  const minimum = Math.min(...market.strikes);
  const maximum = Math.max(...market.strikes);
  if (strike < minimum || strike > maximum) {
    return `Strike price must be between ${formatNumber(minimum, market.strikePrecision)} and ${formatNumber(maximum, market.strikePrecision)} ${market.quote}.`;
  }
  const scale = 10 ** market.strikePrecision;
  const rounded = Math.round(strike * scale) / scale;
  if (Math.abs(strike - rounded) > Math.max(1e-12, Math.abs(strike) * 1e-12)) {
    return `Strike price supports up to ${market.strikePrecision} decimal places.`;
  }
  return "";
}

export function getExpiration(expirationId: ExpirationId) {
  return optionExpirations.find((item) => item.id === expirationId) ?? optionExpirations[0];
}

export function buildTheoreticalQuote(
  market: MarketConfig,
  strike: number,
  side: OptionSide,
  expirationId: ExpirationId,
): TheoreticalQuote {
  const expiration = getExpiration(expirationId);
  const distanceRatio = Math.abs(strike - market.currentPrice) / market.currentPrice;
  const intrinsic = side === "call"
    ? Math.max(market.currentPrice - strike, 0)
    : Math.max(strike - market.currentPrice, 0);
  const timeValue = market.currentPrice * 0.058 * Math.exp(-distanceRatio * 8) * expiration.premiumFactor;
  const directionalSkew = side === "put"
    ? Math.max((market.currentPrice - strike) / market.currentPrice, 0) * 0.08
    : Math.max((strike - market.currentPrice) / market.currentPrice, 0) * 0.04;
  const midpoint = intrinsic + timeValue * (1 + directionalSkew);
  const minimumTick = 10 ** -market.premiumPrecision;
  const spread = Math.max(midpoint * 0.04, minimumTick * 2);
  const downsideSkew = side === "put"
    ? Math.max((market.currentPrice - strike) / market.currentPrice, 0) * 8
    : Math.max((strike - market.currentPrice) / market.currentPrice, 0) * 4;

  return {
    bid: Math.max(minimumTick, midpoint - spread / 2),
    ask: midpoint + spread / 2,
    iv: market.baseIv + distanceRatio * 40 + downsideSkew + expiration.ivShift,
  };
}

export function isOrderActive(order: OptionOrder, now = Date.now()) {
  return (
    order.status === "open"
    && order.remainingQuantity > 0
    && order.expiresAt > now
  );
}

export function displayOrderStatus(order: OptionOrder, now = Date.now()): OrderStatus {
  if (isOrderActive(order, now)) return order.status;
  if (order.status === "open" && order.expiresAt <= now) return "cancelled";
  return order.status;
}

export function matchesContract(order: OptionOrder, draft: Pick<OrderDraft, "pairId" | "optionSide" | "strike" | "expirationId">) {
  const market = marketConfigs[draft.pairId];
  return order.pairId === draft.pairId
    && order.optionSide === draft.optionSide
    && order.strike === draft.strike
    && order.expirationId === draft.expirationId
    && order.contractSize === market.contractSize
    && order.settlementTerms === SETTLEMENT_TERMS;
}

export function availableOrdersForAction(
  orders: OptionOrder[],
  contract: Pick<OrderDraft, "pairId" | "optionSide" | "strike" | "expirationId" | "orderSide">,
) {
  const restingSide: OrderSide = contract.orderSide === "buy" ? "sell" : "buy";
  return orders
    .filter((order) => isOrderActive(order)
      && order.owner !== CURRENT_USER
      && order.orderSide === restingSide
      && matchesContract(order, contract))
    .sort((left, right) => {
      const price = restingSide === "sell"
        ? left.limitPremium - right.limitPremium
        : right.limitPremium - left.limitPremium;
      return price || left.createdAt - right.createdAt;
    });
}

export function matchingOrdersAtPremium(
  orders: OptionOrder[],
  contract: Pick<OrderDraft, "pairId" | "optionSide" | "strike" | "expirationId" | "orderSide">,
  limitPremium: number,
) {
  return availableOrdersForAction(orders, contract).filter((maker) => (
    contract.orderSide === "buy"
      ? limitPremium >= maker.limitPremium
      : limitPremium <= maker.limitPremium
  ));
}

export function executableQuantityAtPremium(
  orders: OptionOrder[],
  contract: Pick<OrderDraft, "pairId" | "optionSide" | "strike" | "expirationId" | "orderSide">,
  limitPremium: number,
) {
  return matchingOrdersAtPremium(orders, contract, limitPremium)
    .reduce((total, maker) => total + maker.remainingQuantity, 0);
}

export function shortenAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export function reservationFor(order: Pick<OptionOrder, "pairId" | "optionSide" | "orderSide" | "strike" | "contractSize" | "limitPremium" | "remainingQuantity">) {
  const market = marketConfigs[order.pairId];
  if (order.orderSide === "buy") {
    return { asset: market.quote, amount: order.limitPremium * order.remainingQuantity * (1 + PROTOCOL_FEE_RATE) };
  }
  if (order.optionSide === "call") {
    return { asset: market.base, amount: order.contractSize * order.remainingQuantity };
  }
  return { asset: market.quote, amount: order.strike * order.contractSize * order.remainingQuantity };
}

export function reservedBalance(orders: OptionOrder[], asset: string, excludeOrderId?: string) {
  return orders.reduce((total, order) => {
    if (order.owner !== CURRENT_USER || order.id === excludeOrderId || !isOrderActive(order)) return total;
    const reservation = reservationFor(order);
    return reservation.asset === asset ? total + reservation.amount : total;
  }, 0);
}

export function availableWalletBalance(
  orders: OptionOrder[],
  asset: string,
  excludeOrderId?: string,
  accountBalances: Readonly<Record<string, number>> = walletBalances,
) {
  return Math.max(0, (accountBalances[asset] ?? 0) - reservedBalance(orders, asset, excludeOrderId));
}

function createGeneratedOrder(
  id: string,
  owner: string,
  market: MarketConfig,
  optionSide: OptionSide,
  orderSide: OrderSide,
  strike: number,
  expirationId: ExpirationId,
  limitPremium: number,
  quantity: number,
  createdAt: number,
): OptionOrder {
  return {
    id,
    owner,
    pairId: market.id,
    optionSide,
    orderSide,
    strike,
    expirationId,
    contractSize: market.contractSize,
    settlementTerms: SETTLEMENT_TERMS,
    limitPremium,
    quantity,
    remainingQuantity: quantity,
    createdAt,
    expiresAt: getExpiration(expirationId).timestamp - 60 * 60 * 1000,
    status: "open",
  };
}

export function createInitialMarketState(): OptionsMarketState {
  const orders: OptionOrder[] = [];
  let sequence = 1;
  const now = INITIAL_MARKET_EPOCH;

  Object.values(marketConfigs).forEach((market, marketIndex) => {
    optionExpirations.forEach((expiration, expirationIndex) => {
      market.strikes.forEach((strike, strikeIndex) => {
        (["call", "put"] as const).forEach((optionSide, sideIndex) => {
          const quote = buildTheoreticalQuote(market, strike, optionSide, expiration.id);
          const seed = marketIndex * 100 + expirationIndex * 30 + strikeIndex * 3 + sideIndex;
          const tick = 10 ** -market.premiumPrecision;
          const baseTime = now - (600 - seed) * 1000;

          if (seed % 7 !== 2) {
            orders.push(createGeneratedOrder(
              `maker-${sequence++}`,
              makerAddresses[seed % makerAddresses.length],
              market,
              optionSide,
              "buy",
              strike,
              expiration.id,
              roundTo(Math.max(tick, quote.bid), market.premiumPrecision),
              [1, 2, 3, 5][seed % 4],
              baseTime,
            ));
          }

          if (seed % 6 !== 1) {
            orders.push(createGeneratedOrder(
              `maker-${sequence++}`,
              makerAddresses[(seed + 2) % makerAddresses.length],
              market,
              optionSide,
              "sell",
              strike,
              expiration.id,
              roundTo(Math.max(tick, quote.ask), market.premiumPrecision),
              [1, 2, 4, 6][(seed + 1) % 4],
              baseTime + 120,
            ));
          }

          if (seed % 5 === 0) {
            const isSell = seed % 2 === 0;
            const basePremium = isSell ? quote.ask : quote.bid;
            orders.push(createGeneratedOrder(
              `maker-${sequence++}`,
              makerAddresses[(seed + 4) % makerAddresses.length],
              market,
              optionSide,
              isSell ? "sell" : "buy",
              strike,
              expiration.id,
              roundTo(Math.max(tick, basePremium + (isSell ? tick : -tick)), market.premiumPrecision),
              2,
              baseTime + 240,
            ));
          }
        });
      });
    });
  });

  const xlm = marketConfigs["XLM-USDC"];
  const eth = marketConfigs["ETH-USDC"];
  const currentOpen = createGeneratedOrder(
    `mine-${sequence++}`, CURRENT_USER, xlm, "call", "buy", 0.26, "30-oct", 0.0095, 4, now - 35 * 60 * 1000,
  );
  const secondOpen = createGeneratedOrder(
    `mine-${sequence++}`, CURRENT_USER, eth, "call", "sell", 4400, "27-nov", 255, 2, now - 90 * 60 * 1000,
  );

  const filledBuy = createGeneratedOrder(
    `mine-${sequence++}`, CURRENT_USER, marketConfigs["BTC-USDC"], "call", "buy", 110000, "30-oct", 8108.11, 1, now - 2 * 60 * 60 * 1000,
  );
  filledBuy.remainingQuantity = 0;
  filledBuy.status = "filled";

  const cancelledSell = createGeneratedOrder(
    `mine-${sequence++}`, CURRENT_USER, xlm, "put", "sell", 0.22, "27-nov", 0.0061, 3, now - 4 * 60 * 60 * 1000,
  );
  cancelledSell.status = "cancelled";
  cancelledSell.cancelledAt = now - 3 * 60 * 60 * 1000;

  const expiredBuy = createGeneratedOrder(
    `mine-${sequence++}`, CURRENT_USER, eth, "call", "buy", 4600, "18-dec", 176, 1, now - 9 * 60 * 60 * 1000,
  );
  expiredBuy.expiresAt = now - 1;

  const incomingCounter = createGeneratedOrder(
    `counter-${sequence++}`, makerAddresses[1], xlm, "call", "sell", 0.26, "30-oct", 0.0102, 2, now - 3 * 60 * 1000,
  );
  incomingCounter.linkedOrderId = currentOpen.id;
  incomingCounter.recipient = CURRENT_USER;

  orders.push(currentOpen, secondOpen, filledBuy, cancelledSell, expiredBuy, incomingCounter);

  return {
    orders,
    fills: [{
      id: "fill-seed-1",
      makerOrderId: filledBuy.id,
      takerOrderId: "maker-seed-fill",
      pairId: filledBuy.pairId,
      optionSide: filledBuy.optionSide,
      strike: filledBuy.strike,
      expirationId: filledBuy.expirationId,
      premium: filledBuy.limitPremium,
      quantity: filledBuy.quantity,
      createdAt: now - 55 * 60 * 1000,
    }],
    positions: [{
      id: "position-seed-1",
      fillId: "fill-seed-1",
      pairId: filledBuy.pairId,
      optionSide: filledBuy.optionSide,
      direction: "long",
      strike: filledBuy.strike,
      expirationId: filledBuy.expirationId,
      quantity: filledBuy.quantity,
      premium: filledBuy.limitPremium,
      counterparty: makerAddresses[0],
      openedAt: now - 55 * 60 * 1000,
      status: "open",
    }, {
      id: "position-seed-2",
      fillId: "fill-seed-2",
      pairId: "XLM-USDC",
      optionSide: "put",
      direction: "short",
      strike: 0.24,
      expirationId: "27-nov",
      quantity: 3,
      premium: 0.014,
      counterparty: makerAddresses[3],
      openedAt: now - 6 * 60 * 60 * 1000,
      status: "open",
    }, {
      id: "position-history-1",
      fillId: "fill-history-1",
      pairId: "ETH-USDC",
      optionSide: "call",
      direction: "long",
      strike: 4200,
      expirationId: "30-oct",
      quantity: 1,
      premium: 238,
      counterparty: makerAddresses[2],
      openedAt: now - 7 * 24 * 60 * 60 * 1000,
      status: "closed",
      closedAt: now - 2 * 24 * 60 * 60 * 1000,
      exitPremium: 264,
    }],
    notifications: [{
      id: "notification-seed-1",
      message: `${shortenAddress(incomingCounter.owner)} proposed ${formatNumber(incomingCounter.limitPremium, xlm.premiumPrecision)} USDC for 2 XLM Calls.`,
      createdAt: incomingCounter.createdAt,
    }],
    sequence,
  };
}

function orderExpiryTimestamp(orderExpiryId: OrderExpiryId, optionExpiration: number, now: number) {
  const option = orderExpiryOptions.find((item) => item.id === orderExpiryId) ?? orderExpiryOptions[0];
  const requested = now + option.milliseconds;
  const tradingCutoff = optionExpiration - 60 * 60 * 1000;
  return Math.min(requested, tradingCutoff);
}

export function suggestionForOrder(orders: OptionOrder[], order: OptionOrder): MarketSuggestion | undefined {
  const candidates = availableOrdersForAction(orders, {
    pairId: order.pairId,
    optionSide: order.optionSide,
    strike: order.strike,
    expirationId: order.expirationId,
    orderSide: order.orderSide,
  }).filter((candidate) => (
    order.orderSide === "buy"
      ? candidate.limitPremium > order.limitPremium
      : candidate.limitPremium < order.limitPremium
  ));
  const first = candidates[0];
  if (!first) return undefined;
  const availableQuantity = candidates
    .filter((candidate) => candidate.limitPremium === first.limitPremium)
    .reduce((sum, candidate) => sum + candidate.remainingQuantity, 0);
  const market = marketConfigs[order.pairId];
  const premium = formatNumber(first.limitPremium, market.premiumPrecision);
  return {
    premium: first.limitPremium,
    availableQuantity,
    message: order.orderSide === "buy"
      ? `Increase your buy limit to ${premium} ${market.quote} to match ${availableQuantity} available ${availableQuantity === 1 ? "contract" : "contracts"}.`
      : `Lower your sell limit to ${premium} ${market.quote} to match ${availableQuantity} available ${availableQuantity === 1 ? "contract" : "contracts"}.`,
  };
}

export function submitOptionOrder(
  state: OptionsMarketState,
  draft: OrderDraft,
  accountBalances: Readonly<Record<string, number>> = walletBalances,
): SubmissionResult {
  const market = marketConfigs[draft.pairId];
  const expiration = getExpiration(draft.expirationId);
  const now = Date.now();
  const quantity = Math.floor(draft.quantity);
  const strikeError = validateOptionStrike(market, draft.strike);
  if (strikeError) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: quantity, message: strikeError };
  }
  if (!Number.isFinite(draft.limitPremium) || draft.limitPremium <= 0) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: quantity, message: "Enter an order premium greater than zero." };
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: 0, message: "Choose at least one contract." };
  }

  const expiresAt = orderExpiryTimestamp(draft.orderExpiryId, expiration.timestamp, now);
  if (expiresAt <= now) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: quantity, message: "Order expiry must be before the option trading cutoff." };
  }

  const orderId = `mine-${state.sequence}`;
  const taker: OptionOrder = {
    id: orderId,
    owner: CURRENT_USER,
    pairId: draft.pairId,
    optionSide: draft.optionSide,
    orderSide: draft.orderSide,
    strike: draft.strike,
    expirationId: draft.expirationId,
    contractSize: market.contractSize,
    settlementTerms: SETTLEMENT_TERMS,
    limitPremium: draft.limitPremium,
    quantity,
    remainingQuantity: quantity,
    createdAt: now,
    expiresAt,
    status: "open",
    linkedOrderId: draft.linkedOrderId,
  };

  const reservation = reservationFor(taker);
  const available = availableWalletBalance(state.orders, reservation.asset, undefined, accountBalances);
  if (reservation.amount > available + Math.max(1e-9, available * 1e-10)) {
    const noun = draft.orderSide === "buy" ? "balance" : "collateral";
    return {
      state,
      ok: false,
      filledQuantity: 0,
      remainingQuantity: quantity,
      message: `Insufficient ${reservation.asset} ${noun}. ${formatNumber(available, market.pricePrecision)} ${reservation.asset} remains after open-order reservations.`,
    };
  }

  let orders = state.orders.map((order) => ({ ...order }));
  const candidates = matchingOrdersAtPremium(orders, draft, draft.limitPremium);
  const fills: OptionFill[] = [];
  const positions: OptionPosition[] = [];
  let sequence = state.sequence + 1;

  const compatibleQuantity = candidates.reduce((total, candidate) => total + candidate.remainingQuantity, 0);
  if (compatibleQuantity >= quantity) {
    for (const candidate of candidates) {
      if (taker.remainingQuantity === 0) break;
      const makerIndex = orders.findIndex((order) => order.id === candidate.id);
      const maker = orders[makerIndex];
      if (!maker || !isOrderActive(maker) || maker.owner === taker.owner) continue;

      const fillQuantity = Math.min(maker.remainingQuantity, taker.remainingQuantity);
      if (fillQuantity <= 0) continue;
      maker.remainingQuantity -= fillQuantity;
      if (maker.remainingQuantity === 0) {
        maker.status = "filled";
      } else {
        maker.quantity = maker.remainingQuantity;
      }
      taker.remainingQuantity -= fillQuantity;

      const fill: OptionFill = {
        id: `fill-${sequence++}`,
        makerOrderId: maker.id,
        takerOrderId: taker.id,
        pairId: taker.pairId,
        optionSide: taker.optionSide,
        strike: taker.strike,
        expirationId: taker.expirationId,
        premium: maker.limitPremium,
        quantity: fillQuantity,
        createdAt: now,
      };
      fills.push(fill);
      positions.push({
        id: `position-${sequence++}`,
        fillId: fill.id,
        pairId: taker.pairId,
        optionSide: taker.optionSide,
        direction: taker.orderSide === "buy" ? "long" : "short",
        strike: taker.strike,
        expirationId: taker.expirationId,
        quantity: fillQuantity,
        premium: maker.limitPremium,
        counterparty: maker.owner,
        openedAt: now,
        status: "open",
      });
    }
  }

  taker.status = taker.remainingQuantity === 0 ? "filled" : "open";
  orders = [...orders, taker];
  const filledQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  const weightedPremium = fills.reduce((sum, fill) => sum + fill.premium * fill.quantity, 0);
  const suggestion = taker.remainingQuantity > 0 ? suggestionForOrder(orders, taker) : undefined;
  const notifications = [...state.notifications];
  if (draft.intent === "counter" && draft.linkedOrderId) {
    const original = state.orders.find((order) => order.id === draft.linkedOrderId);
    notifications.unshift({
      id: `notification-${sequence++}`,
      message: `Public counteroffer sent to ${shortenAddress(original?.owner ?? "the maker")}. It may match compatible orders within your limit.`,
      createdAt: now,
    });
  }
  notifications.unshift({
    id: `notification-${sequence++}`,
    message: filledQuantity > 0
      ? `${filledQuantity} ${filledQuantity === 1 ? "contract" : "contracts"} matched automatically at ${formatNumber(weightedPremium / filledQuantity, market.premiumPrecision)} ${market.quote}.`
      : `Your ${draft.orderSide} order is open at ${formatNumber(draft.limitPremium, market.premiumPrecision)} ${market.quote}.`,
    createdAt: now,
  });

  const nextState: OptionsMarketState = {
    orders,
    fills: [...state.fills, ...fills],
    positions: [...state.positions, ...positions],
    notifications,
    sequence,
  };

  return {
    state: nextState,
    ok: true,
    orderId,
    filledQuantity,
    remainingQuantity: taker.remainingQuantity,
    averagePremium: filledQuantity > 0 ? weightedPremium / filledQuantity : undefined,
    suggestion,
    message: filledQuantity === quantity
      ? `Matched ${filledQuantity} ${filledQuantity === 1 ? "option" : "options"} automatically. Your position is now open.`
      : "The full requested quantity is not currently available. Your order remains open.",
  };
}

export function closeOptionPosition(
  state: OptionsMarketState,
  positionId: string,
  limitPremium: number,
  requestedQuantity: number,
): SubmissionResult {
  const position = state.positions.find((item) => item.id === positionId && item.status === "open");
  const quantity = Math.floor(requestedQuantity);
  if (!position) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: 0, message: "This position is no longer open." };
  }
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > position.quantity) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: position.quantity, message: `Choose between 1 and ${position.quantity} options.` };
  }
  if (!Number.isFinite(limitPremium) || limitPremium <= 0) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: quantity, message: "A current market premium is required to close this position." };
  }

  const market = marketConfigs[position.pairId];
  const orderSide: OrderSide = position.direction === "long" ? "sell" : "buy";
  const draft: OrderDraft = {
    pairId: position.pairId,
    optionSide: position.optionSide,
    orderSide,
    strike: position.strike,
    expirationId: position.expirationId,
    limitPremium,
    quantity,
    orderExpiryId: "1h",
    intent: "take",
    closePositionId: position.id,
  };
  const candidates = matchingOrdersAtPremium(state.orders, draft, limitPremium);
  const compatibleQuantity = candidates.reduce((total, order) => total + order.remainingQuantity, 0);
  if (compatibleQuantity < quantity) {
    return {
      state,
      ok: false,
      filledQuantity: 0,
      remainingQuantity: quantity,
      message: `Only ${compatibleQuantity} ${compatibleQuantity === 1 ? "option is" : "options are"} available at this premium. Your position remains open.`,
    };
  }

  const now = Date.now();
  let sequence = state.sequence;
  let remaining = quantity;
  let weightedPremium = 0;
  const orders = state.orders.map((order) => ({ ...order }));
  const fills: OptionFill[] = [];
  for (const candidate of candidates) {
    if (remaining === 0) break;
    const maker = orders.find((order) => order.id === candidate.id);
    if (!maker || !isOrderActive(maker)) continue;
    const fillQuantity = Math.min(remaining, maker.remainingQuantity);
    maker.remainingQuantity -= fillQuantity;
    if (maker.remainingQuantity === 0) maker.status = "filled";
    remaining -= fillQuantity;
    weightedPremium += maker.limitPremium * fillQuantity;
    fills.push({
      id: `fill-${sequence++}`,
      makerOrderId: maker.id,
      takerOrderId: `close-${position.id}`,
      pairId: position.pairId,
      optionSide: position.optionSide,
      strike: position.strike,
      expirationId: position.expirationId,
      premium: maker.limitPremium,
      quantity: fillQuantity,
      createdAt: now,
    });
  }

  const averagePremium = weightedPremium / quantity;
  const positions = state.positions.flatMap((item): OptionPosition[] => {
    if (item.id !== position.id) return [item];
    const closed: OptionPosition = {
      ...item,
      id: quantity === item.quantity ? item.id : `position-${sequence++}`,
      quantity,
      status: "closed",
      closedAt: now,
      exitPremium: averagePremium,
    };
    if (quantity === item.quantity) return [closed];
    return [{ ...item, quantity: item.quantity - quantity }, closed];
  });
  const action = orderSide === "sell" ? "sold" : "bought to close";
  return {
    state: {
      ...state,
      orders,
      fills: [...state.fills, ...fills],
      positions,
      notifications: [{
        id: `notification-${sequence++}`,
        message: `${quantity} ${market.base} ${position.optionSide === "call" ? "Call" : "Put"} ${action} at ${formatNumber(averagePremium, market.premiumPrecision)} ${market.quote}.`,
        createdAt: now,
      }, ...state.notifications],
      sequence,
    },
    ok: true,
    filledQuantity: quantity,
    remainingQuantity: 0,
    averagePremium,
    message: `Closed ${quantity} ${quantity === 1 ? "option" : "options"} at ${formatNumber(averagePremium, market.premiumPrecision)} ${market.quote}.`,
  };
}

export function cancelOptionOrder(state: OptionsMarketState, orderId: string) {
  const now = Date.now();
  const orders = state.orders.map((order) => order.id === orderId && order.owner === CURRENT_USER && isOrderActive(order)
    ? { ...order, status: "cancelled" as const, cancelledAt: now }
    : order);
  return {
    ...state,
    orders,
    notifications: [{
      id: `notification-${state.sequence}`,
      message: "Unfilled quantity cancelled. Its unused reservation is available again.",
      createdAt: now,
    }, ...state.notifications],
    sequence: state.sequence + 1,
  };
}

export function acceptCounteroffer(state: OptionsMarketState, orderId: string): SubmissionResult {
  const counter = state.orders.find((order) => order.id === orderId && order.recipient === CURRENT_USER && isOrderActive(order));
  if (!counter) {
    return { state, ok: false, filledQuantity: 0, remainingQuantity: 0, message: "This counteroffer is no longer available." };
  }
  return submitOptionOrder(state, {
    pairId: counter.pairId,
    optionSide: counter.optionSide,
    orderSide: counter.orderSide === "buy" ? "sell" : "buy",
    strike: counter.strike,
    expirationId: counter.expirationId,
    limitPremium: counter.limitPremium,
    quantity: counter.remainingQuantity,
    orderExpiryId: "1h",
    intent: "take",
    linkedOrderId: counter.id,
  });
}
