"use client";

import { type ReactNode, useState } from "react";
import { Icon } from "./icon";
import { formatSpotQuoteAmount, formatSpotFee } from "./spot-utils";
import { spotCandidateMinimum, spotProtocol, spotQuoteProtocols, type SpotApiLeg, type SpotCandidate } from "./spot-api";

const hopCount = (count: number) => `${count} ${count === 1 ? "hop" : "hops"}`;
const legVenues = (leg: SpotApiLeg) => [...new Set(leg.hops.map(hop => spotProtocol(hop.protocol)))].join(" + ");

// Stays mounted while closed so closing animates; inert keeps hidden content out of focus and the accessibility tree.
export function SpotAccordion({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return <div className="spot-accordion" id={id} data-open={open} inert={!open}><div>{children}</div></div>;
}

function SpotQuoteBreakdown({ quote }: { quote: SpotCandidate }) {
  const api = quote.soroban;
  const legs = api?.legs ?? [];
  return <div className="spot-quote-breakdown">
    {!api ? <><p><strong className="trade-number">100%</strong> routed through Stellar native AMM &amp; order books across {hopCount(quote.route.length - 1)}.</p><p>{quote.route.map(asset => asset.code).join(" → ")}</p></>
      : legs.length === 1 ? <p><strong className="trade-number">100%</strong> routed through {legVenues(legs[0])} across {hopCount(legs[0].hops.length)}.</p>
      : <>
        <p>Split across {legs.length} routes through {spotQuoteProtocols(quote)}.</p>
        <ul className="spot-quote-legs">{legs.map((leg, index) => <li key={`${leg.routeId}:${index}`}>
          <strong className="trade-number">{leg.sharePct}%</strong>
          <span>{legVenues(leg)} · {leg.pathSymbols.join(" → ")}</span>
          <span>{hopCount(leg.hops.length)}</span>
        </li>)}</ul>
      </>}
  </div>;
}

export function SpotRouteDetails({ quote }: { quote: SpotCandidate }) {
  const api = quote.soroban;
  if (!api) return null;
  return <div className="spot-route-detail">
    {api.legs.map((leg, index) => <section className="spot-route-leg" key={`${leg.routeId}:${index}`} aria-label={`Route ${index + 1}, ${leg.sharePct}%`}>
      <div className="spot-route-leg-head"><strong>{leg.sharePct}% allocation</strong><span>{formatSpotQuoteAmount(leg.amountIn)} {quote.request.from.code}</span></div>
      <p>{leg.pathSymbols.join(" → ")}</p>
      <ol>{leg.hops.map((hop, i) => <li key={`${hop.poolAddress}:${i}`}><span className="spot-route-hop-meta">Hop {i + 1} · {spotProtocol(hop.protocol)}</span><strong>{leg.pathSymbols[i]} → {leg.pathSymbols[i + 1]}</strong><small title={hop.poolAddress}>Pool {hop.poolAddress.slice(0, 6)}…{hop.poolAddress.slice(-6)} · {hop.model}</small></li>)}</ol>
      <p>Output {formatSpotQuoteAmount(leg.amountOut)} {quote.request.to.code} · Minimum {formatSpotQuoteAmount(leg.minimumReceived)} {quote.request.to.code}</p>
    </section>)}
    <dl className="trade-breakdown"><div className="trade-breakdown-row"><dt>Aggregator fee (included)</dt><dd>{api.feeBps / 100}% · {formatSpotFee(BigInt(api.feeAmountRaw))} {quote.request.to.code}</dd></div>
      <div className="trade-breakdown-row"><dt>Price impact</dt><dd>{api.priceImpactPct === null ? "Unavailable" : `${api.priceImpactPct}%`}</dd></div>
      <div className="trade-breakdown-row"><dt>Quote expires</dt><dd><time dateTime={api.expiresAt}>{new Date(api.expiresAt).toLocaleTimeString()}</time></dd></div>
    </dl>
    {api.isEstimate && <p className="spot-quote-notice">Estimated pool output. The transaction will be simulated before wallet approval.</p>}
  </div>;
}

export function SpotQuoteOptions({ quotes, selected, bps, onSelect, disabled, loading, error, onRetry, connected, apiEnabled }: {
  quotes: SpotCandidate[]; selected?: SpotCandidate; onSelect: (id: string) => void;
  bps: number; disabled: boolean; loading: boolean; error?: string; onRetry: () => void; connected: boolean; apiEnabled: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string>();
  return <section className="spot-quotes" aria-labelledby="spot-quotes-title">
    <div className="spot-quotes-head"><h3 id="spot-quotes-title">{apiEnabled || quotes.length > 1 ? "Compare quotes" : "Swap quote"}</h3><span>{loading ? "Finding routes…" : `${quotes.length} ${quotes.length === 1 ? "quote" : "quotes"}`}</span></div>
    <div role="radiogroup" aria-label="Swap quote" className="spot-quote-list">{quotes.map((quote, index) => {
      const checked = selected?.id === quote.id;
      const expanded = checked && expandedId === quote.id;
      const breakdownId = `spot-quote-breakdown-${index}`;
      const minimum = spotCandidateMinimum(quote, bps);
      return <div className="spot-quote-option" data-selected={checked} data-expanded={expanded} key={quote.id}>
        <div className="spot-quote-head">
          <label className="spot-quote-choice" title={`Minimum received: ${minimum} ${quote.request.to.code}. Estimated output: ${quote.output} ${quote.request.to.code}.`}>
            <input className="spot-quote-radio" type="radio" name="spot-quote" value={quote.id} checked={checked} disabled={disabled} onChange={() => { setExpandedId(undefined); onSelect(quote.id); }} />
            <span className="spot-quote-mark" aria-hidden="true" />
            <span className="spot-quote-copy"><strong>{spotQuoteProtocols(quote)}</strong><span>{quote.source === "native" ? quote.route.map(asset => asset.code).join(" → ") : quote.soroban?.type === "split" ? `Soroban · Split across ${quote.soroban.legs.length} routes` : "Soroban"}{quote.soroban?.isEstimate ? " · Estimate" : ""}</span>{index === 0 && quotes.length > 1 && <span className="spot-quote-best">Best minimum received</span>}</span>
            <span className="spot-quote-output"><strong className="trade-number">Min {formatSpotQuoteAmount(minimum)} {quote.request.to.code}</strong><span>Est. {formatSpotQuoteAmount(quote.output)} {quote.request.to.code}</span></span>
            <Icon className="spot-quote-chevron" name="chevron-down" size={16} />
          </label>
          {/* Once chosen, the whole card discloses its routing instead of re-selecting. */}
          {checked && <button className="spot-quote-toggle" type="button" aria-expanded={expanded} aria-controls={breakdownId}
            aria-label={`${expanded ? "Hide" : "Show"} routing breakdown for ${spotQuoteProtocols(quote)}`}
            onClick={() => setExpandedId(expanded ? undefined : quote.id)} />}
        </div>
        {checked && <SpotAccordion open={expanded} id={breakdownId}><SpotQuoteBreakdown quote={quote} /></SpotAccordion>}
      </div>;
    })}</div>
    {!apiEnabled ? null : error ? <div className="spot-quote-notice" role="status"><span>Soroban quotes unavailable: {error}</span><button className="spot-inline-action" type="button" disabled={disabled || loading} onClick={onRetry}>Retry Soroban quotes</button></div>
      : !loading && !quotes.some(quote => quote.source === "soroban") ? <p className="spot-quote-notice">No Soroban route for this amount. Try another amount or pair.</p>
      : !connected ? <p className="spot-quote-notice">Connect your wallet to swap.</p> : null}
  </section>;
}
