"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AssetPairSelector, type AssetPairId } from "./asset-pair-selector";
import {
  formatFinancial,
  formatFinancialWithAsset,
  formatInteger,
  formatSignedFinancial,
  nextDecimalInputValue,
} from "./financial-format";
import { Icon } from "./icon";
import {
  PROTOCOL_FEE_RATE,
  buildTheoreticalQuote,
  matchingOrdersAtPremium,
  marketConfigs,
  optionExpirations,
  validateOptionStrike,
  type ExpirationId,
  type MarketConfig,
  type OptionOrder,
  type OptionSide,
  type OrderDraft,
  type OrderIntent,
  type OrderSide,
  type SubmissionResult,
} from "./options-market";
import { useAccessibleOverlay } from "./use-accessible-overlay";

export type OptionContractSide = OptionSide;
export type OptionOrderMode = OrderSide;

export type OptionDrawerRequest = {
  source: "chain" | "create" | "counter" | "adjust" | "position";
  action: OrderSide;
  intent: OrderIntent;
  targetOrderId?: string;
  initialPremium?: number;
  initialQuantity?: number;
  maximumQuantity?: number;
  positionId?: string;
  replaceOrderId?: string;
  requestKey: string;
};

export type OptionDrawerContract = {
  pairId: AssetPairId;
  base: string;
  quote: string;
  currentPrice: number;
  strike: number;
  iv: number;
  side: OptionContractSide;
  expirationId: ExpirationId;
  expirationLabel: string;
  timeRemaining: string;
  pricePrecision: number;
  strikePrecision: number;
  premiumPrecision: number;
  contractSize: number;
  availableBaseBalance: number;
  availableQuoteBalance: number;
};

export type OptionDrawerConfiguration = {
  pairId?: AssetPairId;
  side?: OptionSide;
  strike?: number;
  expirationId?: ExpirationId;
};

type PayoffPoint = { price: number; pnl: number; x: number; y: number };
type OptionDrawerTab = "trade" | "greeks";
type OptionTradeView = "summary" | "profit";
type PremiumAdjustment = -0.15 | 0 | 0.15;
type GreekMetric = {
  name: string;
  symbol: string;
  description: string;
  exposure: number;
};

const protocolFeeRate = PROTOCOL_FEE_RATE;

const formatNumber = (value: number, precision?: number) => {
  void precision;
  return formatFinancial(value);
};
const formatCompact = (value: number, precision?: number) => {
  void precision;
  return formatFinancial(value);
};
const formatAssetAmount = (value: number, asset: string, minimumPrecision?: number) => {
  void minimumPrecision;
  return formatFinancialWithAsset(value, asset);
};

function exceedsAvailable(required: number, available: number) {
  const tolerance = Math.max(1e-9, Math.abs(available) * 1e-10);
  return required - available > tolerance;
}

function payoffAtPrice(
  underlyingPrice: number,
  strike: number,
  side: OptionContractSide,
  mode: OptionOrderMode,
  underlyingQuantity: number,
  totalPremium: number,
  protocolFee: number,
) {
  const intrinsic = side === "call"
    ? Math.max(underlyingPrice - strike, 0) * underlyingQuantity
    : Math.max(strike - underlyingPrice, 0) * underlyingQuantity;
  return mode === "buy"
    ? intrinsic - totalPremium - protocolFee
    : totalPremium - protocolFee - intrinsic;
}

function affordableContractQuantity(contract: OptionDrawerContract, mode: OptionOrderMode, price: number) {
  const affordable = mode === "buy"
    ? price > 0 ? contract.availableQuoteBalance / (price * (1 + protocolFeeRate)) : 0
    : contract.side === "call"
      ? contract.availableBaseBalance / contract.contractSize
      : contract.availableQuoteBalance / (contract.strike * contract.contractSize);
  if (!Number.isFinite(affordable) || affordable < 1) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(affordable + 1e-9));
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const coefficients = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const polynomial = coefficients.reduceRight((result, coefficient) => (result + coefficient) * t, 0);
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function formatGreekValue(value: number) {
  return formatSignedFinancial(value);
}

function buildGreekMetrics(
  contract: OptionDrawerContract,
  mode: OptionOrderMode,
  amount: number,
): GreekMetric[] {
  const daysRemaining = Math.max(1, Number.parseFloat(contract.timeRemaining) || 1);
  const time = daysRemaining / 365;
  const volatility = Math.max(0.01, contract.iv / 100);
  const rate = 0.04;
  const sqrtTime = Math.sqrt(time);
  const d1 = (
    Math.log(Math.max(contract.currentPrice, 1e-8) / Math.max(contract.strike, 1e-8))
    + (rate + volatility * volatility / 2) * time
  ) / (volatility * sqrtTime);
  const d2 = d1 - volatility * sqrtTime;
  const density = Math.exp(-(d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  const discount = Math.exp(-rate * time);
  const isCall = contract.side === "call";
  const direction = mode === "buy" ? 1 : -1;
  const contractScale = contract.contractSize * direction;
  const delta = (isCall ? normalCdf(d1) : normalCdf(d1) - 1) * contractScale;
  const gamma = density / (contract.currentPrice * volatility * sqrtTime) * contractScale;
  const thetaBase = -(contract.currentPrice * density * volatility) / (2 * sqrtTime);
  const thetaRate = isCall
    ? -rate * contract.strike * discount * normalCdf(d2)
    : rate * contract.strike * discount * normalCdf(-d2);
  const theta = ((thetaBase + thetaRate) / 365) * contractScale;
  const vega = (contract.currentPrice * density * sqrtTime / 100) * contractScale;
  const rho = (
    isCall
      ? contract.strike * time * discount * normalCdf(d2) / 100
      : -contract.strike * time * discount * normalCdf(-d2) / 100
  ) * contractScale;
  const safeAmount = Math.max(0, amount);
  const metrics = [
    { name: "Delta", symbol: "Δ", description: "Price sensitivity", value: delta },
    { name: "Gamma", symbol: "Γ", description: "Delta curvature", value: gamma },
    { name: "Theta", symbol: "Θ", description: "Daily time decay", value: theta },
    { name: "Vega", symbol: "ν", description: "Volatility sensitivity", value: vega },
    { name: "Rho", symbol: "ρ", description: "Rate sensitivity", value: rho },
  ];
  return metrics.map(({ value, ...metric }) => ({
    ...metric,
    exposure: value * safeAmount,
  }));
}

function OptionGreeksPanel({
  contract,
  mode,
  amount,
}: {
  contract: OptionDrawerContract;
  mode: OptionOrderMode;
  amount: number;
}) {
  const metrics = buildGreekMetrics(contract, mode, amount);
  return (
    <section className="option-greeks-panel" aria-labelledby="option-greeks-title">
      <div className="option-section-heading">
        <div>
          <h3 id="option-greeks-title">Position Greeks</h3>
          <p>{mode === "buy" ? "Buy" : "Sell"}: {formatInteger(Math.max(0, amount))} {amount === 1 ? "option" : "options"}</p>
        </div>
        <span>Illustrative exposure</span>
      </div>
      <div className="option-greeks-table-wrap">
        <table className="option-greeks-table">
          <caption className="trade-sr-only">Position Greek exposure for the selected option size</caption>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.name}>
                <th scope="row">
                  <span>{metric.name} <i>{metric.symbol}</i></span>
                  <small>{metric.description}</small>
                </th>
                <td>{formatGreekValue(metric.exposure)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OptionPayoffChart({
  contract,
  mode,
  amount,
  price,
}: {
  contract: OptionDrawerContract;
  mode: OptionOrderMode;
  amount: number;
  price: number;
}) {
  const chartId = useId().replace(/:/g, "");
  const chartRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 400;
  const height = 268;
  const plot = { left: 46, right: 388, top: 24, bottom: 224 };
  const underlyingQuantity = Math.max(0, amount * contract.contractSize);
  const totalPremium = Math.max(0, price * amount);
  const protocolFee = totalPremium * protocolFeeRate;
  const effectivePremium = mode === "buy" ? totalPremium + protocolFee : Math.max(0, totalPremium - protocolFee);
  const premiumPerUnderlying = underlyingQuantity > 0 ? effectivePremium / underlyingQuantity : 0;
  const breakEven = contract.side === "call"
    ? contract.strike + premiumPerUnderlying
    : Math.max(0, contract.strike - premiumPerUnderlying);

  const { points, zeroY, range } = useMemo(() => {
    const anchors = [contract.currentPrice, contract.strike, breakEven].filter(Number.isFinite);
    const smallestAnchor = Math.min(...anchors);
    const largestAnchor = Math.max(...anchors);
    const minimumPrice = Math.max(0, smallestAnchor * 0.55);
    const maximumPrice = Math.max(largestAnchor * 1.45, minimumPrice + Math.max(contract.currentPrice * 0.4, 0.01));
    const raw = Array.from({ length: 61 }, (_, index) => {
      const underlyingPrice = minimumPrice + ((maximumPrice - minimumPrice) * index) / 60;
      return {
        price: underlyingPrice,
        pnl: payoffAtPrice(
          underlyingPrice,
          contract.strike,
          contract.side,
          mode,
          underlyingQuantity,
          totalPremium,
          protocolFee,
        ),
      };
    });
    const greatestMagnitude = Math.max(1e-6, ...raw.map((point) => Math.abs(point.pnl))) * 1.12;
    const xFor = (value: number) => plot.left + ((value - minimumPrice) / (maximumPrice - minimumPrice)) * (plot.right - plot.left);
    const yFor = (value: number) => plot.top + ((greatestMagnitude - value) / (greatestMagnitude * 2)) * (plot.bottom - plot.top);
    return {
      points: raw.map((point) => ({ ...point, x: xFor(point.price), y: yFor(point.pnl) })),
      zeroY: yFor(0),
      range: { minimumPrice, maximumPrice, greatestMagnitude, xFor },
    };
  }, [amount, breakEven, contract.currentPrice, contract.side, contract.strike, mode, price, protocolFee, totalPremium, underlyingQuantity]);

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points.at(-1)?.x ?? plot.right} ${zeroY} L${points[0]?.x ?? plot.left} ${zeroY} Z`;
  const currentX = range.xFor(contract.currentPrice);
  const strikeX = range.xFor(contract.strike);
  const breakEvenX = range.xFor(breakEven);
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = Math.max(0, Math.min(1, (viewX - plot.left) / (plot.right - plot.left)));
    setHoveredIndex(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className="option-payoff-content">
      <div className="option-payoff-chart">
        <svg
          ref={chartRef}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${chartId}-title ${chartId}-desc`}
          onPointerDown={handlePointerMove}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <title id={`${chartId}-title`}>{mode === "buy" ? "Bought" : "Sold"} {contract.side} payoff at expiration</title>
          <desc id={`${chartId}-desc`}>Profit and loss across underlying prices, with current price, strike, break-even, and zero-profit markers.</desc>
          <defs>
            <clipPath id={`${chartId}-positive`}><rect x="0" y="0" width={width} height={zeroY} /></clipPath>
            <clipPath id={`${chartId}-negative`}><rect x="0" y={zeroY} width={width} height={height - zeroY} /></clipPath>
          </defs>

          {[plot.top, zeroY, plot.bottom].map((y, index) => (
            <line key={index} className={index === 1 ? "option-chart-zero" : "option-chart-grid"} x1={plot.left} x2={plot.right} y1={y} y2={y} />
          ))}
          <text className="option-chart-axis-label" x="4" y={plot.top + 4}>+{formatCompact(range.greatestMagnitude, 1)}</text>
          <text className="option-chart-axis-label" x="24" y={zeroY + 4}>0</text>
          <text className="option-chart-axis-label" x="4" y={plot.bottom + 4}>−{formatCompact(range.greatestMagnitude, 1)}</text>

          <path className="option-chart-area option-chart-area--profit" d={areaPath} clipPath={`url(#${chartId}-positive)`} />
          <path className="option-chart-area option-chart-area--loss" d={areaPath} clipPath={`url(#${chartId}-negative)`} />
          <path className="option-chart-line option-chart-line--profit" d={linePath} clipPath={`url(#${chartId}-positive)`} />
          <path className="option-chart-line option-chart-line--loss" d={linePath} clipPath={`url(#${chartId}-negative)`} />

          <line className="option-chart-marker option-chart-marker--current" x1={currentX} x2={currentX} y1={plot.top} y2={plot.bottom} />
          <line className="option-chart-marker option-chart-marker--strike" x1={strikeX} x2={strikeX} y1={plot.top} y2={plot.bottom} />
          <line className="option-chart-marker option-chart-marker--break-even" x1={breakEvenX} x2={breakEvenX} y1={plot.top} y2={plot.bottom} />

          {hoveredPoint && (
            <>
              <line className="option-chart-hover-line" x1={hoveredPoint.x} x2={hoveredPoint.x} y1={plot.top} y2={plot.bottom} />
              <circle className={hoveredPoint.pnl >= 0 ? "option-chart-point option-chart-point--profit" : "option-chart-point option-chart-point--loss"} cx={hoveredPoint.x} cy={hoveredPoint.y} r="3.5" />
            </>
          )}

          <text className="option-chart-axis-label" x={plot.left} y="246">{formatCompact(range.minimumPrice, contract.pricePrecision)}</text>
          <text className="option-chart-axis-label" textAnchor="end" x={plot.right} y="246">{formatCompact(range.maximumPrice, contract.pricePrecision)}</text>
          <text className="option-chart-axis-title" textAnchor="middle" x={(plot.left + plot.right) / 2} y="260">{contract.base} price at expiration</text>
        </svg>

        {hoveredPoint && (
          <div
            className="option-chart-tooltip"
            style={{ left: `${Math.max(13, Math.min(87, (hoveredPoint.x / width) * 100))}%` }}
          >
            <span>{formatNumber(hoveredPoint.price, contract.pricePrecision)} {contract.quote}</span>
            <strong className={hoveredPoint.pnl >= 0 ? "trade-positive" : "trade-negative"}>
              {hoveredPoint.pnl >= 0 ? "+" : "−"}{formatAssetAmount(Math.abs(hoveredPoint.pnl), contract.quote)}
            </strong>
          </div>
        )}
      </div>
      <div className="option-chart-legend" aria-hidden="true">
        <span><i className="is-current" />Current</span>
        <span><i className="is-strike" />Strike</span>
        <span><i className="is-break-even" />Break-even</span>
      </div>
    </div>
  );
}

function parsePremium(value: string) {
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatStrikeInput(value: number, precision: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.min(2, precision),
    maximumFractionDigits: precision,
    useGrouping: true,
  }).format(value);
}

function validateStrikeInput(value: string, market: MarketConfig) {
  const normalized = value.replaceAll(",", "").trim();
  if (!normalized) return { strike: undefined, message: "Enter a strike price." };
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return { strike: undefined, message: "Enter a valid numeric strike price." };
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > market.strikePrecision) {
    return { strike: undefined, message: `Strike price supports up to ${market.strikePrecision} decimal places.` };
  }
  const strike = Number(normalized);
  const message = validateOptionStrike(market, strike);
  return { strike: message ? undefined : strike, message };
}

function CounterIcon({ kind }: { kind: "minus" | "plus" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={kind === "minus" ? "M5 12h14" : "M5 12h14M12 5v14"} /></svg>;
}

function PremiumSelector({
  mode,
  quote,
  price,
  adjustment,
  baseLabel,
  marketLabel,
  disabled,
  onAdjustmentChange,
}: {
  mode: OptionOrderMode;
  quote: string;
  price: number;
  adjustment: PremiumAdjustment;
  baseLabel: "Calculated" | "Selected price" | "Current limit";
  marketLabel: string;
  disabled: boolean;
  onAdjustmentChange: (adjustment: PremiumAdjustment) => void;
}) {
  const actionLabel = mode === "buy" ? "Buy" : "Sell";
  const stateLabel = adjustment === -0.15
    ? `15% below ${baseLabel.toLowerCase()}`
    : adjustment === 0.15
      ? `15% above ${baseLabel.toLowerCase()}`
      : baseLabel;
  const decreaseLabel = adjustment === 0.15
    ? "Return premium to base price"
    : "Decrease premium to 15% below base";
  const increaseLabel = adjustment === -0.15
    ? "Return premium to base price"
    : "Increase premium to 15% above base";

  return (
    <section className="option-order-section option-premium-adjustment" aria-labelledby="option-premium-adjustment-title">
      <div className="option-section-heading">
        <h3 id="option-premium-adjustment-title">{actionLabel} premium</h3>
        <span className="option-premium-availability" aria-live="polite">{marketLabel}</span>
      </div>
      <div className="option-premium-adjustment-stepper" role="group" aria-label={`${actionLabel} premium adjustment`}>
        <button
          type="button"
          aria-label={decreaseLabel}
          disabled={adjustment === -0.15 || disabled}
          onClick={() => onAdjustmentChange(adjustment === 0.15 ? 0 : -0.15)}
        >
          −15%
        </button>
        <output
          className="option-premium-base"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>{formatFinancial(price)} {quote}</strong>
          <span>{stateLabel}</span>
        </output>
        <button
          type="button"
          aria-label={increaseLabel}
          disabled={adjustment === 0.15 || disabled}
          onClick={() => onAdjustmentChange(adjustment === -0.15 ? 0 : 0.15)}
        >
          +15%
        </button>
      </div>
    </section>
  );
}

export function OptionDetailDrawer({
  open,
  closing,
  contract: suppliedContract,
  request,
  orders,
  onActionChange,
  onConfigurationChange,
  onSubmit,
  onClose,
  onExitComplete,
}: {
  open: boolean;
  closing: boolean;
  contract: OptionDrawerContract | null;
  request: OptionDrawerRequest | null;
  orders: OptionOrder[];
  onActionChange: (mode: OptionOrderMode, strike?: number) => void;
  onConfigurationChange: (change: OptionDrawerConfiguration) => void;
  onSubmit: (draft: OrderDraft, replaceOrderId?: string) => SubmissionResult;
  onClose: () => void;
  onExitComplete: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [compact, setCompact] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState<OptionDrawerTab>("trade");
  const [tradeView, setTradeView] = useState<OptionTradeView>("summary");
  const [premiumAdjustment, setPremiumAdjustment] = useState<PremiumAdjustment>(0);
  const [intent, setIntent] = useState<OrderIntent>("take");
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const [premiumInput, setPremiumInput] = useState("");
  const [strikeInput, setStrikeInput] = useState<string | null>(null);
  const [editableStrike, setEditableStrike] = useState<number | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult>();
  const [replaceOrderId, setReplaceOrderId] = useState<string>();
  const mode = request?.action ?? "buy";
  const isMarketDetail = request?.source === "chain";
  const isCreateMode = request?.source === "create";
  const isAdjustmentMode = request?.source === "adjust";
  const isPositionClose = request?.source === "position";
  const present = open || closing;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- The portal must wait for the client document after SSR.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the imperative entry animation before the next animation frame.
      setEntered(false);
      return;
    }
    setEntered(false);
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 47.9375rem)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useAccessibleOverlay(present && compact, onClose, drawerRef);

  useEffect(() => {
    if (!open || !suppliedContract || !request) return;
    const target = request.targetOrderId ? orders.find((order) => order.id === request.targetOrderId) : undefined;
    const defaultPremium = request.initialPremium ?? target?.limitPremium;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A versioned external drawer request starts a fresh draft without remounting the exit animation.
    setActiveTab("trade");
    setTradeView("summary");
    setPremiumAdjustment(0);
    setIntent(request.intent);
    setSelectedOrderId(request.targetOrderId);
    setPremiumInput(defaultPremium === undefined ? "" : String(defaultPremium));
    setStrikeInput(formatStrikeInput(suppliedContract.strike, suppliedContract.strikePrecision));
    setEditableStrike(suppliedContract.strike);
    setQuantity(Math.max(1, Math.floor(request.initialQuantity ?? 1)));
    setSubmission(undefined);
    setReplaceOrderId(request.replaceOrderId);
    const frame = window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, request?.requestKey]);

  useEffect(() => {
    if (!present || compact) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (drawerRef.current?.contains(event.target)) return;
      if (event.target.closest(".option-quote-button, .asset-select-menu")) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (returnFocus?.isConnected) {
        window.requestAnimationFrame(() => returnFocus.focus());
      }
    };
  }, [compact, onClose, present]);

  if (!mounted || (!open && !closing) || !suppliedContract || !request) return null;

  const strikeMarket = marketConfigs[suppliedContract.pairId];
  const displayedStrikeInput = strikeInput ?? formatStrikeInput(suppliedContract.strike, suppliedContract.strikePrecision);
  const strikeValidation = isCreateMode
    ? validateStrikeInput(displayedStrikeInput, strikeMarket)
    : { strike: suppliedContract.strike, message: "" };
  const activeStrike = isCreateMode ? editableStrike ?? suppliedContract.strike : suppliedContract.strike;
  const activeContract = activeStrike === suppliedContract.strike
    ? suppliedContract
    : { ...suppliedContract, strike: activeStrike };
  const contract = activeContract;

  const selectedOrder = selectedOrderId ? orders.find((order) => order.id === selectedOrderId) : undefined;
  const theoreticalQuote = buildTheoreticalQuote(
    marketConfigs[contract.pairId],
    contract.strike,
    contract.side,
    contract.expirationId,
  );
  const calculatedPremium = mode === "buy" ? theoreticalQuote.ask : theoreticalQuote.bid;
  const basePremium = isCreateMode
    ? calculatedPremium
    : request.initialPremium ?? selectedOrder?.limitPremium ?? 0;
  const adjustedPremium = basePremium * (1 + premiumAdjustment);
  const selectedQuote = isCreateMode || isMarketDetail || isAdjustmentMode
    ? adjustedPremium
    : isPositionClose
      ? basePremium
      : parsePremium(premiumInput);
  const amount = quantity;
  const price = selectedQuote;
  const underlyingQuantity = amount * contract.contractSize;
  const totalPremium = price * amount;
  const protocolFee = totalPremium * protocolFeeRate;
  const totalCost = totalPremium + protocolFee;
  const premiumReceived = Math.max(0, totalPremium - protocolFee);
  const effectivePremium = mode === "buy" ? totalCost : premiumReceived;
  const requiredCollateral = mode === "sell"
    ? contract.side === "call"
      ? underlyingQuantity
      : contract.strike * underlyingQuantity
    : 0;
  const affordableQuantity = affordableContractQuantity(contract, mode, price);
  const matchingOrders = price > 0
    ? matchingOrdersAtPremium(orders, {
      pairId: contract.pairId,
      optionSide: contract.side,
      strike: contract.strike,
      expirationId: contract.expirationId,
      orderSide: mode,
    }, price)
    : [];
  const executableQuantity = matchingOrders.reduce((total, order) => total + order.remainingQuantity, 0);
  const marketAvailabilityLabel = mode === "buy"
    ? `${formatInteger(executableQuantity)} available`
    : `${formatInteger(matchingOrders.length)} ${matchingOrders.length === 1 ? "buy order" : "buy orders"}`;
  const requestedMaximum = request.maximumQuantity ?? Number.POSITIVE_INFINITY;
  const fundedMaximum = isPositionClose && mode === "sell" ? requestedMaximum : affordableQuantity;
  const maximumQuantity = Math.max(1, Math.min(fundedMaximum, requestedMaximum));
  const breakEven = contract.side === "call"
    ? contract.strike + (underlyingQuantity > 0 ? effectivePremium / underlyingQuantity : 0)
    : Math.max(0, contract.strike - (underlyingQuantity > 0 ? effectivePremium / underlyingQuantity : 0));
  const maximumRisk = mode === "buy"
    ? formatAssetAmount(totalCost, contract.quote)
    : contract.side === "call"
      ? "Uncapped"
      : formatAssetAmount(Math.max(0, requiredCollateral - premiumReceived), contract.quote);
  const maximumProfit = mode === "buy" && contract.side === "call"
    ? "Uncapped"
    : mode === "buy"
      ? formatAssetAmount(Math.max(0, contract.strike * underlyingQuantity - totalCost), contract.quote)
      : formatAssetAmount(premiumReceived, contract.quote);
  const collateralAsset = contract.side === "call" ? contract.base : contract.quote;
  const collateralValue = formatFinancial(requiredCollateral);
  const collateralLabel = `${collateralValue} ${collateralAsset}`;

  let validationTitle = "";
  let validationMessage = "";
  if (submission?.ok) {
    validationTitle = "";
    validationMessage = "";
  } else if (strikeValidation.message) {
    validationTitle = "Invalid strike price";
    validationMessage = strikeValidation.message;
  } else if (price <= 0) {
    validationTitle = isMarketDetail ? "Quote unavailable" : "Enter an order premium";
    validationMessage = isMarketDetail ? "Choose another quoted price from the options chain." : "Your order premium must be greater than zero.";
  } else if (mode === "buy" && exceedsAvailable(totalCost, contract.availableQuoteBalance)) {
    validationTitle = "Insufficient balance";
    validationMessage = "Open orders already reserve part of your balance. Reduce the option size.";
  } else if (!isPositionClose && mode === "sell" && contract.side === "call" && exceedsAvailable(requiredCollateral, contract.availableBaseBalance)) {
    validationTitle = "Insufficient collateral";
    validationMessage = `Covered Calls require the full ${contract.base} quantity, net of existing order reservations.`;
  } else if (!isPositionClose && mode === "sell" && contract.side === "put" && exceedsAvailable(requiredCollateral, contract.availableQuoteBalance)) {
    validationTitle = "Insufficient collateral";
    validationMessage = `Cash-secured Puts require strike × underlying quantity in ${contract.quote}, net of existing reservations.`;
  }

  function changeQuantity(delta: -1 | 1) {
    setQuantity((current) => delta === 1
      ? Math.min(maximumQuantity, current + 1)
      : Math.max(1, current - 1));
    setSubmission(undefined);
  }

  function submitOrder() {
    if (validationMessage) return;
    const result = onSubmit({
      pairId: activeContract.pairId,
      optionSide: activeContract.side,
      orderSide: mode,
      strike: activeContract.strike,
      expirationId: activeContract.expirationId,
      limitPremium: price,
      quantity,
      orderExpiryId: "1h",
      intent,
      linkedOrderId: intent === "counter" ? selectedOrder?.id : undefined,
      closePositionId: request?.positionId,
    }, replaceOrderId);
    setSubmission(result);
    if (result.ok && result.remainingQuantity > 0) setReplaceOrderId(result.orderId);
  }

  function applySuggestion() {
    if (!submission?.suggestion) return;
    setIntent("limit");
    setSelectedOrderId(undefined);
    setPremiumInput(String(submission.suggestion.premium));
    setSubmission(undefined);
  }

  function updateStrikeInput(next: string) {
    setStrikeInput(next);
    const nextValidation = validateStrikeInput(next, strikeMarket);
    if (nextValidation.strike !== undefined) setEditableStrike(nextValidation.strike);
    setSubmission(undefined);
  }

  function commitStrikeInput() {
    if (strikeValidation.strike === undefined) return;
    setStrikeInput(formatStrikeInput(strikeValidation.strike, contract.strikePrecision));
    onConfigurationChange({ strike: strikeValidation.strike });
  }

  const sideLabel = contract.side === "call" ? "Call" : "Put";
  const actionLabel = mode === "buy" ? "Buy" : "Sell";
  const counterOriginal = intent === "counter" ? selectedOrder : undefined;
  const primaryLabel = isPositionClose
    ? mode === "sell"
      ? `Sell ${quantity} ${quantity === 1 ? "option" : "options"}`
      : `Buy ${quantity} to close`
    : isAdjustmentMode
      ? "Save changes"
      : intent === "counter"
    ? "Submit counteroffer"
    : intent === "take"
      ? `${actionLabel} ${quantity} ${quantity === 1 ? "option" : "options"}`
      : `Place ${mode} order`;
  const settlementLabel = mode === "buy" ? "You Pay" : "Required Collateral";
  const settlementValue = mode === "buy"
    ? formatAssetAmount(totalCost, contract.quote).slice(0, -(contract.quote.length + 1))
    : collateralValue;
  const settlementAsset = mode === "buy" ? contract.quote : collateralAsset;

  function handleDrawerTransitionEnd(event: ReactTransitionEvent<HTMLElement>) {
    if (!closing || event.target !== event.currentTarget || event.propertyName !== "transform") return;
    onExitComplete();
  }

  return createPortal(
    <div className="option-drawer-layer" data-entered={open && entered} data-closing={closing}>
      <div className="option-drawer-scrim" aria-hidden="true" />
      <aside
        ref={drawerRef}
        className="option-detail-drawer"
        role="dialog"
        aria-modal={compact}
        aria-labelledby="option-detail-title"
        onTransitionEnd={handleDrawerTransitionEnd}
      >
        <header className="option-drawer-header">
          <div className="option-drawer-title-row">
            <div className="option-drawer-title-copy">
              <div className="option-drawer-contract-line">
                <h2 id="option-detail-title">{contract.base} / {contract.quote} · {formatNumber(contract.strike, contract.strikePrecision)}</h2>
                <span className={`trade-badge trade-badge--${contract.side}`}>{sideLabel}</span>
              </div>
              <p>{contract.expirationLabel} · {contract.timeRemaining} remaining</p>
            </div>
            <button ref={closeButtonRef} className="trade-icon-button option-drawer-close" type="button" aria-label="Close option details" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
          {(isMarketDetail || isPositionClose) && (
            <div className={`option-selected-quote option-selected-quote--${mode}`}>
              <span>Selected {actionLabel}</span>
              <strong className="trade-number">{formatNumber(price, contract.premiumPrecision)} {contract.quote}</strong>
            </div>
          )}
          <div className="trade-tabs option-drawer-tabs" role="tablist" aria-label="Option details">
            <button
              className={`trade-tab${activeTab === "trade" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "trade"}
              aria-controls="option-trade-panel"
              onClick={() => setActiveTab("trade")}
            >
              Trade
            </button>
            <button
              className={`trade-tab${activeTab === "greeks" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "greeks"}
              aria-controls="option-greeks-panel"
              onClick={() => setActiveTab("greeks")}
            >
              Greeks
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="option-drawer-scroll">
          {activeTab === "trade" ? (
            <div id="option-trade-panel" className="option-trade-panel" role="tabpanel">
              <div className="trade-segmented option-order-side-toggle" role="group" aria-label="Order side">
                <button type="button" aria-pressed={mode === "buy"} disabled={isPositionClose || isAdjustmentMode} onClick={() => onActionChange("buy", contract.strike)}>Buy</button>
                <button type="button" aria-pressed={mode === "sell"} disabled={isPositionClose || isAdjustmentMode} onClick={() => onActionChange("sell", contract.strike)}>Sell</button>
              </div>

              {isCreateMode && (
                <section className="option-order-section option-contract-builder" aria-labelledby="option-contract-builder-title">
                  <div className="option-section-heading"><h3 id="option-contract-builder-title">Contract</h3><span>Standardized terms</span></div>
                  <div className="option-builder-pair">
                    <span>Asset pair</span>
                    <AssetPairSelector label="Order asset pair" value={contract.pairId} variant="segmented" onChange={(pairId) => onConfigurationChange({ pairId })} />
                  </div>
                  <div className="trade-segmented option-builder-side" role="group" aria-label="Option type">
                    <button type="button" aria-pressed={contract.side === "call"} onClick={() => onConfigurationChange({ side: "call", strike: contract.strike })}>Call</button>
                    <button type="button" aria-pressed={contract.side === "put"} onClick={() => onConfigurationChange({ side: "put", strike: contract.strike })}>Put</button>
                  </div>
                  <label className="option-strike-field">
                    <span>Strike price</span>
                    <span className={`option-strike-input${strikeValidation.message ? " is-error" : ""}`}>
                      <input
                        inputMode="decimal"
                        aria-invalid={Boolean(strikeValidation.message)}
                        aria-describedby="option-strike-help"
                        value={displayedStrikeInput}
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={commitStrikeInput}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                            return;
                          }
                          if (event.metaKey || event.ctrlKey || event.altKey) return;
                          const replaceAll = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === event.currentTarget.value.length;
                          const next = nextDecimalInputValue(displayedStrikeInput, event.key, replaceAll, contract.strikePrecision);
                          if (next === undefined) return;
                          event.preventDefault();
                          updateStrikeInput(next);
                        }}
                        onChange={(event) => updateStrikeInput(event.target.value.replaceAll(",", ""))}
                      />
                      <b>{contract.quote}</b>
                    </span>
                  </label>
                  <p id="option-strike-help" className={`option-field-help${strikeValidation.message ? " is-error" : ""}`}>
                    {strikeValidation.message || `${formatNumber(Math.min(...strikeMarket.strikes), contract.strikePrecision)}–${formatNumber(Math.max(...strikeMarket.strikes), contract.strikePrecision)} ${contract.quote} · Up to ${contract.strikePrecision} decimals`}
                  </p>
                  <div className="option-builder-label">Option expiration</div>
                  <div className="trade-segmented option-builder-expirations" role="radiogroup" aria-label="Option expiration">
                    {optionExpirations.map((item) => (
                      <button type="button" role="radio" aria-checked={item.id === contract.expirationId} key={item.id} onClick={() => onConfigurationChange({ expirationId: item.id, strike: contract.strike })}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {(isCreateMode || isMarketDetail || isAdjustmentMode) && (
                <PremiumSelector
                  mode={mode}
                  quote={contract.quote}
                  price={price}
                  adjustment={premiumAdjustment}
                  baseLabel={isCreateMode ? "Calculated" : isAdjustmentMode ? "Current limit" : "Selected price"}
                  marketLabel={marketAvailabilityLabel}
                  disabled={Boolean(submission?.ok)}
                  onAdjustmentChange={(next) => { setPremiumAdjustment(next); setSubmission(undefined); }}
                />
              )}

              {!isMarketDetail && !isCreateMode && !isAdjustmentMode && !isPositionClose && (
                <section className="option-order-section option-limit-editor" aria-labelledby="option-limit-title">
                  <div className="option-section-heading">
                    <h3 id="option-limit-title">{intent === "counter" ? "Counteroffer premium" : "Order premium"}</h3>
                    <span>{contract.quote} per option</span>
                  </div>
                  {counterOriginal && (
                    <div className="option-counter-terms">
                      <div><span>Original</span><strong>{formatNumber(counterOriginal.limitPremium, contract.premiumPrecision)} {contract.quote} · {counterOriginal.remainingQuantity} options</strong></div>
                      <div><span>Proposed</span><strong>{price > 0 ? formatNumber(price, contract.premiumPrecision) : "—"} {contract.quote} · {quantity} options</strong></div>
                    </div>
                  )}
                  <label className="option-premium-field">
                    <span>Premium</span>
                    <span className="option-premium-input">
                      <input
                        inputMode="decimal"
                        aria-describedby="option-limit-help"
                        value={premiumInput ? formatFinancial(parsePremium(premiumInput)) : ""}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          if (event.metaKey || event.ctrlKey || event.altKey) return;
                          const replaceAll = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === event.currentTarget.value.length;
                          const next = nextDecimalInputValue(premiumInput, event.key, replaceAll);
                          if (next === undefined) return;
                          event.preventDefault();
                          setPremiumInput(next);
                          setSubmission(undefined);
                        }}
                        onChange={(event) => { setPremiumInput(event.target.value.replaceAll(",", "")); setSubmission(undefined); }}
                      />
                      <b>{contract.quote}</b>
                    </span>
                  </label>
                  <p id="option-limit-help" className="option-field-help">Set the premium for this new order.</p>
                </section>
              )}

              <section className="option-order-section option-quantity-section" aria-labelledby="option-quantity-title">
                <div className="option-size-heading">
                  <h3 id="option-quantity-title">Option Size</h3>
                </div>
                <div className="option-contract-counter" role="group" aria-label="Option size">
                      <button
                        type="button"
                        aria-label="Decrease option size"
                        disabled={quantity === 1 || submission?.ok}
                        onClick={() => changeQuantity(-1)}
                      >
                        <CounterIcon kind="minus" />
                      </button>
                      <output aria-live="polite" aria-label={`${quantity} ${quantity === 1 ? "option" : "options"} selected`}>{formatInteger(quantity)}</output>
                      <button
                        type="button"
                        aria-label="Increase option size"
                        disabled={quantity >= maximumQuantity || submission?.ok}
                        onClick={() => changeQuantity(1)}
                      >
                        <CounterIcon kind="plus" />
                      </button>
                </div>
                <label className="option-settlement-field">
                  <span>{settlementLabel}</span>
                  <span className="option-settlement-value">
                    <input
                      className="trade-number"
                      value={settlementValue}
                      readOnly
                      aria-readonly="true"
                    />
                    <b>{settlementAsset}</b>
                  </span>
                </label>
              </section>

              <div className="trade-segmented option-trade-view-tabs" role="tablist" aria-label="Trade information">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tradeView === "summary"}
                  aria-controls="option-order-summary-panel"
                  onClick={() => setTradeView("summary")}
                >
                  Order Summary
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tradeView === "profit"}
                  aria-controls="option-profit-simulation-panel"
                  onClick={() => setTradeView("profit")}
                >
                  Profit Simulation
                </button>
              </div>

              {tradeView === "summary" ? (
                <section
                  id="option-order-summary-panel"
                  className="option-trade-view-panel option-order-summary"
                  role="tabpanel"
                  aria-labelledby="option-summary-title"
                >
                  <h3 id="option-summary-title" className="option-summary-contract">
                    {actionLabel} {formatInteger(quantity)} {contract.base} {formatNumber(contract.strike, contract.strikePrecision)} {sideLabel} {quantity === 1 ? "option" : "options"}
                  </h3>
                  <dl className="option-summary-list">
                    <div><dt>Size</dt><dd>{formatInteger(quantity)}</dd></div>
                    <div><dt>Premium per option</dt><dd>{formatNumber(price, contract.premiumPrecision)} {contract.quote}</dd></div>
                    <div><dt>Trade fee</dt><dd>{formatAssetAmount(protocolFee, contract.quote)}</dd></div>
                    <div className={`option-summary-total${mode === "sell" ? " option-summary-profit" : ""}`}>
                      <dt>
                        {mode === "buy" ? "Total cost" : "Profit"}
                        {mode === "sell" && <small>Premium after trade fee</small>}
                      </dt>
                      <dd>{formatAssetAmount(mode === "buy" ? totalCost : premiumReceived, contract.quote)}</dd>
                    </div>
                  </dl>
                </section>
              ) : (
                <section
                  id="option-profit-simulation-panel"
                  className="option-trade-view-panel option-profit-simulation"
                  role="tabpanel"
                  aria-labelledby="option-profit-title"
                >
                  <div className="option-section-heading">
                    <h3 id="option-profit-title">Profit Simulation</h3>
                    <span>At expiration</span>
                  </div>
                  <dl className="option-profit-metrics">
                    <div><dt>Break-even price</dt><dd>{formatNumber(breakEven, contract.pricePrecision)} {contract.quote}</dd></div>
                    <div className="is-profit"><dt>Maximum profit</dt><dd>{maximumProfit}</dd></div>
                    <div className="is-loss"><dt>Maximum loss or obligation</dt><dd>{maximumRisk}</dd></div>
                    {mode === "sell" && <div><dt>Required collateral</dt><dd>{collateralLabel}</dd></div>}
                  </dl>
                  <div className="option-payoff-section" aria-labelledby="option-payoff-title">
                    <div className="option-section-heading option-payoff-heading">
                      <h3 id="option-payoff-title">Payoff at expiration</h3>
                      <span>Estimated P&amp;L in {contract.quote}</span>
                    </div>
                    <OptionPayoffChart contract={contract} mode={mode} amount={amount} price={price} />
                  </div>
                </section>
              )}

              {(validationMessage || submission) && (
                <div className="option-feedback-area">
                  {validationMessage && (
                    <div className="trade-alert trade-alert--error option-order-alert" role="alert">
                      <span className="trade-alert-mark">Error</span>
                      <div><strong>{validationTitle}</strong><p>{validationMessage}</p></div>
                    </div>
                  )}
                  {submission && (
                    <div className={`option-submission-result ${submission.ok ? "is-success" : "is-error"}`} role={submission.ok ? "status" : "alert"}>
                      <strong>{submission.ok ? "Order processed" : "Order not submitted"}</strong>
                      <p>{submission.message}</p>
                      {submission.suggestion && (
                        <div className="option-premium-suggestion">
                          <span>{submission.suggestion.message}</span>
                          <button type="button" onClick={applySuggestion}>Review and apply</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div id="option-greeks-panel" role="tabpanel">
              <OptionGreeksPanel contract={contract} mode={mode} amount={amount} />
            </div>
          )}
        </div>

        <footer className="option-drawer-action">
          <button
            className="trade-button trade-button--primary trade-button--lg trade-button--block"
            type="button"
            disabled={Boolean(validationMessage) || Boolean(submission?.ok)}
            onClick={submitOrder}
          >
            {submission?.ok ? (submission.remainingQuantity === 0 ? "Order filled" : "Order open") : primaryLabel}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
