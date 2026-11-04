"use client";

import { type ReactNode } from "react";
import { Icon } from "./icon";
import { formatSpotQuoteAmount, type SpotAsset } from "./spot-utils";
import { formatSpotShare, spotProtocol, spotQuoteProtocols, type SpotApiLeg, type SpotCandidate } from "./spot-api";
import { SpotTokenIcon } from "./spot-token-icon";

const legVenues = (leg: SpotApiLeg) => [...new Set(leg.hops.map(hop => spotProtocol(hop.protocol)))].join(" + ");

// Stays mounted while closed so closing animates; inert keeps hidden content out of focus and the accessibility tree.
export function SpotAccordion({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return <div className="spot-accordion" id={id} data-open={open} inert={!open}><div>{children}</div></div>;
}

function SpotRouteAssets({ assets }: { assets: SpotAsset[] }) {
  return <span className="spot-route-assets">{assets.map((asset, index) => <span className="spot-route-token-step" key={`${asset.id}:${index}`}>
    {index > 0 && <Icon name="chevron-right" size={16} />}
    <span className="spot-route-asset"><SpotTokenIcon asset={asset} /><span>{asset.code}</span></span>
  </span>)}</span>;
}

export function SpotRouteDetails({ quote }: { quote: SpotCandidate }) {
  const api = quote.soroban;
  const pair = [quote.request.from, quote.request.to];
  const split = Boolean(api && api.legs.length > 1);
  return <ul className="spot-route-paths" data-split={split}>
    {split ? api!.legs.map((leg, index) => <li key={`${leg.routeId}:${index}`}>
      <strong className="spot-route-share trade-number">{formatSpotShare(leg.sharePct)}</strong>
      <SpotRouteAssets assets={pair} />
      <span className="spot-route-venue">({legVenues(leg)})</span>
    </li>) : <li>
      <SpotRouteAssets assets={api ? pair : quote.route} />
      <span className="spot-route-venue">({spotQuoteProtocols(quote)})</span>
    </li>}
  </ul>;
}

export function SpotQuoteOptions({ quotes, selected, onSelect, disabled, loading, error, onRetry, apiEnabled }: {
  quotes: SpotCandidate[]; selected?: SpotCandidate; onSelect: (id: string) => void;
  disabled: boolean; loading: boolean; error?: string; onRetry: () => void; apiEnabled: boolean;
}) {
  return <section className="spot-quotes" aria-labelledby="spot-quotes-title">
    <div className="spot-quotes-head"><h3 id="spot-quotes-title">{apiEnabled || quotes.length > 1 ? "Compare quotes" : "Swap quote"}</h3><span>{loading ? "Finding routes…" : `${quotes.length} ${quotes.length === 1 ? "quote" : "quotes"}`}</span></div>
    <div role="radiogroup" aria-label="Swap quote" className="spot-quote-list">{quotes.map((quote, index) => {
      const checked = selected?.id === quote.id;
      const routeCount = quote.soroban?.legs.length ?? 1;
      const output = formatSpotQuoteAmount(quote.output, 7);
      return <div className="spot-quote-option" data-selected={checked} key={quote.id}>
        <div className="spot-quote-head">
          <label className="spot-quote-choice">
            <input className="spot-quote-radio" type="radio" name="spot-quote" value={quote.id} checked={checked} disabled={disabled} onChange={() => onSelect(quote.id)} />
            <span className="spot-quote-mark" aria-hidden="true" />
            <span className="spot-quote-copy"><strong>{spotQuoteProtocols(quote)}</strong><span>{routeCount === 1 ? "Single route" : `Split across ${routeCount} routes`}</span>{index === 0 && quotes.length > 1 && <span className="spot-quote-best">Best net received</span>}</span>
            <span className="spot-quote-output"><strong className="trade-number">{output} {quote.request.to.code}</strong></span>
          </label>
        </div>
      </div>;
    })}</div>
    {!apiEnabled ? null : error ? <div className="spot-quote-notice" role="status"><span>Soroban quotes unavailable: {error}</span><button className="spot-inline-action" type="button" disabled={disabled || loading} onClick={onRetry}>Retry Soroban quotes</button></div>
      : !loading && !quotes.some(quote => quote.source === "soroban") ? <p className="spot-quote-notice">No Soroban route for this amount. Try another amount or pair.</p>
      : null}
  </section>;
}
