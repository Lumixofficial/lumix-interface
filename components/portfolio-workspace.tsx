"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatFinancial, formatFinancialWithAsset, formatSignedFinancial } from "./financial-format";
import { cumulativePnl, deduplicate, optionHistory, type PnlPeriod, type PnlView, type PortfolioRecords } from "./portfolio-records";
import { LUMIX_STELLAR_NETWORK } from "./stellar-network";
import { usePortfolioRecords } from "./use-portfolio-records";
import { useWallet } from "./wallet-provider";

type Product = "Spot" | "Options" | "Perpetuals";
const products: Product[] = ["Spot", "Options", "Perpetuals"];
const views: PnlView[] = ["Overall", "Options", "Perpetuals"];
const periods: PnlPeriod[] = ["1W", "1M", "3M", "All"];
const date = (at: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(at);
const time = (at: number) => new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(at);

function TransactionLink({ hash }: { hash?: string }) {
  return hash && /^[a-f0-9]{64}$/i.test(hash)
    ? <a href={`${LUMIX_STELLAR_NETWORK.explorerBaseUrl}/tx/${hash}`} target="_blank" rel="noreferrer" aria-label={`View transaction ${hash} on Stellar Expert (opens in a new tab)`}>View transaction</a>
    : <span aria-label="No transaction available">—</span>;
}

function DateCell({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}>{date(at)}<small>{time(at)} UTC</small></time>;
}

function DirectionBadge({ side }: { side: "Buy" | "Sell" | "Long" | "Short" }) {
  const positive = side === "Buy" || side === "Long";
  return <span className={`trade-badge trade-badge--${positive ? "long" : "short"}`}>{side}</span>;
}

function PnlValue({ value, currency = "USDC" }: { value?: number; currency?: string }) {
  if (value === undefined || !Number.isFinite(value)) {
    return <span className="portfolio-pnl-cell is-unavailable" aria-label="Realized P&L unavailable">—</span>;
  }
  const tone = Math.abs(value) < 0.005 ? "is-neutral" : value > 0 ? "is-positive" : "is-negative";
  return <span className={`portfolio-pnl-cell trade-number ${tone}`}>{formatSignedFinancial(value)} {currency}</span>;
}

function Chart({ data, view, period, now }: { data: PortfolioRecords; view: PnlView; period: PnlPeriod; now: number }) {
  const points = useMemo(() => cumulativePnl(data.outcomes, view, period, now), [data.outcomes, view, period, now]);
  const [hovered, setHovered] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, entry.contentRect.width)));
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [points.length > 0]);
  const total = points.at(-1)?.value;
  const active = hovered !== null ? points[hovered] : undefined;
  const minimum = points.reduce((value, point) => Math.min(value, point.value), 0);
  const maximum = points.reduce((value, point) => Math.max(value, point.value), 0);
  const min = minimum === maximum ? minimum - 1 : minimum;
  const max = minimum === maximum ? maximum + 1 : maximum;
  const range = max - min;
  const first = points[0]?.at ?? now;
  const last = points.at(-1)?.at ?? now;
  const left = Math.min(width * 0.35, Math.max(60, Math.max(formatFinancial(min).length, formatFinancial(max).length) * 7 + 12));
  const right = width - 20;
  const x = (at: number) => last === first ? (left + right) / 2 : left + ((at - first) / (last - first)) * (right - left);
  const y = (value: number) => 265 - ((value - min) / range) * 220;
  // Step changes only at recorded outcomes; no invented daily returns.
  const path = points.map((point, index) => index === 0
    ? `M ${x(point.at)} ${y(point.value)}`
    : `H ${x(point.at)} V ${y(point.value)}`).join(" ");
  const tone = total === undefined || total === 0 ? "" : total > 0 ? "is-positive" : "is-negative";
  function move(event: KeyboardEvent<SVGSVGElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setHovered(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, (hovered ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
  }
  return <>
    <div className="portfolio-pnl-value">
      <strong className={`trade-number ${tone}`}>{total === undefined ? "—" : formatSignedFinancial(total)} <span>USDC</span></strong>
      <span>Cumulative realized P&amp;L · {period === "All" ? "All time" : `Last ${period === "1W" ? "7" : period === "1M" ? "30" : "90"} days`}</span>
    </div>
    {points.length === 0 ? <div className="portfolio-chart-empty" role="status">
      <strong>No P&amp;L data yet</strong>
      <p>Realized trade outcomes will appear here. Preview activity and margin payments do not contribute to P&amp;L.</p>
    </div> : <div ref={chartRef} className={`portfolio-chart ${tone}`}>
      <div className="portfolio-chart-tooltip" aria-live="polite">{active ? `${date(active.at)} · ${time(active.at)} UTC · ${formatSignedFinancial(active.value)} USDC` : "Hover or use arrow keys to inspect recorded outcomes"}</div>
      <svg viewBox={`0 0 ${width} 320`} role="img" tabIndex={0} aria-label={`${view} cumulative realized P&L, ${formatSignedFinancial(total!)} USDC. Use left and right arrow keys to inspect outcomes.`}
        onKeyDown={move} onBlur={() => setHovered(null)} onPointerLeave={() => setHovered(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width * width;
          let nearest = 0;
          points.forEach((point, index) => { if (Math.abs(x(point.at) - px) < Math.abs(x(points[nearest].at) - px)) nearest = index; });
          setHovered(nearest);
        }}>
        {[max, (max + min) / 2, min].map((value, index) => <g key={index} className="portfolio-chart-axis"><line x1={left} x2={right} y1={45 + index * 110} y2={45 + index * 110} /><text x={left - 12} y={50 + index * 110} textAnchor="end">{formatFinancial(value)}</text></g>)}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {points.length === 1 && <circle cx={x(first)} cy={y(points[0].value)} r="4" fill="currentColor" />}
        {active && <g><line x1={x(active.at)} x2={x(active.at)} y1="35" y2="275" className="portfolio-chart-cursor" /><circle cx={x(active.at)} cy={y(active.value)} r="5" fill="currentColor" /></g>}
        <g className="portfolio-chart-axis"><text x={left} y="306">{date(first)}</text>{first !== last && <text x={right} y="306" textAnchor="end">{date(last)}</text>}</g>
      </svg>
    </div>}
  </>;
}

function History({ data, product, now }: { data: PortfolioRecords; product: Product; now: number }) {
  const [limit, setLimit] = useState(20);
  const spot = deduplicate(data.spot).sort((a, b) => b.at - a.at);
  const options = optionHistory(data.options, now);
  const payments = deduplicate(data.payments).sort((a, b) => b.at - a.at);
  const count = product === "Spot" ? spot.length : product === "Options" ? options.length : payments.length;
  const headings = product === "Spot" ? ["Date", "Pair", "Paid", "Received", "Fee", "Status", "Transaction"]
    : product === "Options" ? ["Date", "Option", "Side", "Size", "Premium", "Status", "Realized P&L"]
      : ["Date", "Market", "Side", "Amount", "Status", "Realized P&L", "Transaction"];
  const numeric = product === "Spot" ? [2, 3, 4] : product === "Options" ? [3, 4, 6] : [3, 5];
  if (!count) return <div className="portfolio-history-empty" role="status"><strong>No {product.toLowerCase()} history yet</strong><p>Your recorded {product === "Spot" ? "swaps" : product === "Options" ? "orders and trade activity" : "payments and trade activity"} will appear here.</p></div>;
  return <>
    <div className="portfolio-table-scroll" role="region" aria-label={`${product} history table, scroll horizontally for all columns`} tabIndex={0}>
      <table className={`portfolio-table portfolio-table--${product.toLowerCase()}`}><caption className="trade-sr-only">{product} history, newest first. Dates in UTC.</caption>
        <thead><tr>{headings.map((heading, index) => <th key={heading} scope="col" className={numeric.includes(index) ? "is-numeric" : ""}>{heading}</th>)}</tr></thead>
        <tbody>
          {product === "Spot" && spot.slice(0, limit).map((record) => <tr key={record.id}>
            <td><DateCell at={record.at} /></td><td>{record.paidAsset} / {record.receivedAsset}</td>
            <td className="is-numeric trade-number">{formatFinancialWithAsset(record.paid, record.paidAsset)}</td><td className="is-numeric trade-number">{formatFinancialWithAsset(record.received, record.receivedAsset)}</td>
            <td className="is-numeric trade-number">{record.fees.length ? record.fees.map((fee, index) => <div key={index} title={`${fee.amount} ${fee.asset}`}>{formatFinancialWithAsset(fee.amount, fee.asset)}</div>) : "—"}</td>
            <td className="portfolio-status">{record.provenance === "preview" ? "Completed · preview" : "Completed"}</td>
            <td><TransactionLink hash={record.provenance === "confirmed" ? record.transactionHash : undefined} /></td>
          </tr>)}
          {product === "Options" && options.slice(0, limit).map((record) => <tr key={record.id}>
            <td><DateCell at={record.at} /></td><td>{record.option.replace(/ (\d+(?:\.\d+)?) /, (_, strike) => ` ${formatFinancial(Number(strike))} `)}<small>Expires {date(record.expiration)}</small></td>
            <td><DirectionBadge side={record.side} /></td><td className="is-numeric trade-number">{formatFinancial(record.size)}</td><td className="is-numeric trade-number">{formatFinancialWithAsset(record.premium, "USDC")}<small>per contract</small></td><td className="portfolio-status">{record.status}</td><td className="is-numeric"><PnlValue /></td>
          </tr>)}
          {product === "Perpetuals" && payments.slice(0, limit).map((record) => <tr key={record.id}>
            <td><DateCell at={record.at} /></td><td>{record.position.marketId.replace("-", " / ")}</td><td><DirectionBadge side={record.position.side === "long" ? "Long" : "Short"} /></td>
            <td className="is-numeric trade-number">{formatFinancialWithAsset(record.position.margin, "USDC")}</td><td className="portfolio-status">Payment confirmed</td><td className="is-numeric"><PnlValue /></td><td><TransactionLink hash={record.position.transactionHash} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="portfolio-history-footer"><span>{Math.min(limit, count)} of {count} records</span>{count > limit && <button type="button" className="trade-button trade-button--secondary" onClick={() => setLimit((value) => value + 20)}>Load more</button>}</div>
  </>;
}

export function PortfolioWorkspace() {
  const wallet = useWallet();
  const account = wallet.isAuthenticated ? wallet.address : undefined;
  const history = usePortfolioRecords(account);
  const [view, setView] = useState<PnlView>("Overall");
  const [period, setPeriod] = useState<PnlPeriod>("1M");
  const [product, setProduct] = useState<Product>("Spot");
  const [now, setNow] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize the client clock after deterministic SSR, then synchronize with the timer.
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  return <>
    <header className="options-page-header"><div className="options-title-block"><h1>Portfolio</h1></div></header>
    {!account ? <div className="portfolio-account-state"><h2>Connect wallet to view your portfolio</h2><p>Your trading history on Stellar testnet.</p><button className="trade-button trade-button--primary wallet-connect-button" type="button" disabled={!wallet.isReady || wallet.isConnecting} onClick={() => void wallet.connect()}>{wallet.isConnecting ? "Connecting…" : "Connect wallet"}</button></div>
      : history.status === "loading" ? <div className="portfolio-account-state" role="status">Loading your portfolio…</div>
        : history.status === "error" ? <div className="portfolio-account-state" role="alert"><h2>Portfolio could not be loaded</h2><p>Your saved history is unavailable. Please try again.</p><button className="trade-button trade-button--secondary" type="button" onClick={history.reload}>Retry</button></div>
          : history.data && <>
            <section className="portfolio-performance" aria-labelledby="portfolio-performance-title">
              <div className="portfolio-chart-heading"><h2 id="portfolio-performance-title">Profit &amp; loss</h2><div className="portfolio-controls" role="group" aria-label="P&L period">{periods.map((item) => <button key={item} type="button" aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
              <div className="portfolio-controls portfolio-view-controls" role="group" aria-label="P&L view">{views.map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
              <Chart key={`${account}:${view}:${period}`} data={history.data} view={view} period={period} now={now} />
              <p className="portfolio-chart-note">Options and Perpetuals · Realized P&amp;L after fees · USDC</p>
            </section>
            <section className="portfolio-history" aria-labelledby="portfolio-history-title">
              <h2 id="portfolio-history-title">Trading history</h2>
              <div className="portfolio-tabs" role="tablist" aria-label="Trading history" onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const index = products.indexOf(product);
                const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                setProduct(products[next]);
                document.getElementById(`portfolio-tab-${products[next]}`)?.focus();
              }}>{products.map((item) => <button key={item} id={`portfolio-tab-${item}`} role="tab" aria-selected={item === product} aria-controls="portfolio-history-panel" tabIndex={item === product ? 0 : -1} type="button" onClick={() => setProduct(item)}>{item}</button>)}</div>
              <div id="portfolio-history-panel" role="tabpanel" aria-labelledby={`portfolio-tab-${product}`}><History key={`${account}:${product}`} data={history.data} product={product} now={now} /></div>
            </section>
          </>}
  </>;
}
