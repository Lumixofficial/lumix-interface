"use client";

import { Icon } from "./icon";
import { formatSpotAmount, formatSpotFee } from "./spot-utils";
import { spotProtocol, spotQuoteProtocols, type SpotCandidate } from "./spot-api";

export function SpotRouteDetails({ quote }: { quote: SpotCandidate }) {
  const api = quote.soroban;
  if (!api) return <div className="spot-route-detail"><p>Stellar native AMM / order book · {quote.route.length - 1} {quote.route.length === 2 ? "hop" : "hops"} · 100%</p>
    <ol>{quote.route.slice(0, -1).map((asset, index) => <li key={`${asset.id}:${index}`}><span>Hop {index + 1}</span><strong>{asset.code} → {quote.route[index + 1].code}</strong></li>)}</ol>
    <p>Stellar path payments can use liquidity pools and order book offers. The native quote does not identify the venue used for each hop.</p></div>;
  return <div className="spot-route-detail">
    {api.legs.map((leg, index) => <section className="spot-route-leg" key={`${leg.routeId}:${index}`} aria-label={`Route ${index + 1}, ${leg.sharePct}%`}>
      <div className="spot-route-leg-head"><strong>{leg.sharePct}% allocation</strong><span>{formatSpotAmount(leg.amountIn)} {quote.request.from.code}</span></div>
      <p>{leg.pathSymbols.join(" → ")}</p>
      <ol>{leg.hops.map((hop, i) => <li key={`${hop.poolAddress}:${i}`}><span>Hop {i + 1} · {spotProtocol(hop.protocol)}</span><strong>{leg.pathSymbols[i]} → {leg.pathSymbols[i + 1]}</strong><small title={hop.poolAddress}>Pool {hop.poolAddress.slice(0, 6)}…{hop.poolAddress.slice(-6)} · {hop.model}</small></li>)}</ol>
      <p>Output {formatSpotAmount(leg.amountOut)} {quote.request.to.code} · Minimum {formatSpotAmount(leg.minimumReceived)} {quote.request.to.code}</p>
    </section>)}
    <dl className="trade-breakdown"><div className="trade-breakdown-row"><dt>Aggregator fee (included)</dt><dd>{api.feeBps / 100}% · {formatSpotFee(BigInt(api.feeAmountRaw))} {quote.request.to.code}</dd></div>
      <div className="trade-breakdown-row"><dt>Price impact</dt><dd>{api.priceImpactPct === null ? "Unavailable" : `${api.priceImpactPct}%`}</dd></div>
      <div className="trade-breakdown-row"><dt>Quote expires</dt><dd><time dateTime={api.expiresAt}>{new Date(api.expiresAt).toLocaleTimeString()}</time></dd></div>
    </dl>
    {api.isEstimate && <p className="spot-quote-notice">Estimated pool output. The transaction will be simulated before wallet approval.</p>}
  </div>;
}

export function SpotQuoteOptions({ quotes, selected, onSelect, disabled, loading, error, onRetry, testnet, connected, apiEnabled }: {
  quotes: SpotCandidate[]; selected?: SpotCandidate; onSelect: (id: string) => void;
  disabled: boolean; loading: boolean; error?: string; onRetry: () => void; testnet: boolean; connected: boolean; apiEnabled: boolean;
}) {
  return <section className="spot-quotes" aria-labelledby="spot-quotes-title">
    <div className="spot-quotes-head"><h3 id="spot-quotes-title">{apiEnabled ? "Compare quotes" : "Swap quote"}</h3><span>{loading ? "Finding Soroban routes…" : `${quotes.length} ${quotes.length === 1 ? "quote" : "quotes"}`}</span></div>
    <div role="radiogroup" aria-label="Swap quote" className="spot-quote-list">{quotes.map((quote, index) => <div className="spot-quote-option" data-selected={selected?.id === quote.id} key={quote.id}>
      <label className="spot-quote-select"><input type="radio" name="spot-quote" value={quote.id} checked={selected?.id === quote.id} disabled={disabled} onChange={() => onSelect(quote.id)} />
        <span className="spot-quote-copy"><strong>{spotQuoteProtocols(quote)}</strong><span>{quote.source === "native" ? "Native Stellar" : quote.soroban?.type === "split" ? `Soroban · Split across ${quote.soroban.legs.length} routes` : "Soroban"}{quote.soroban?.isEstimate ? " · Estimate" : ""}</span></span>
        <span className="spot-quote-output"><strong className="trade-number" title={`${quote.output} ${quote.request.to.code}`}>{formatSpotAmount(quote.output)} {quote.request.to.code}</strong>{index === 0 && quotes.length > 1 && <span>Best output</span>}</span>
      </label>
      <details><summary>Route details <Icon name="chevron-down" size={14} /></summary><SpotRouteDetails quote={quote} /></details>
    </div>)}</div>
    {!apiEnabled ? null : testnet ? <p className="spot-quote-notice">Soroban quotes are available on Mainnet. Select Mainnet to compare both sources.</p>
      : !connected ? <p className="spot-quote-notice">Connect your wallet to compare Soroban quotes.</p>
      : error ? <div className="spot-quote-notice" role="status"><span>Soroban quotes unavailable: {error}</span><button className="spot-inline-action" type="button" disabled={disabled || loading} onClick={onRetry}>Retry Soroban quotes</button></div>
      : !loading && !quotes.some(quote => quote.source === "soroban") ? <p className="spot-quote-notice">No Soroban route for this amount. Try another amount or pair.</p> : null}
  </section>;
}
