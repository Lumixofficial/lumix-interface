import { Icon } from "./icon";
import { Fragment, type ReactNode } from "react";
import { SpotTokenIcon } from "./spot-token-icon";
import tokenImages from "./spot-token-images.json";
import { SPOT_MAINNET_USDC_ISSUER, SPOT_NETWORK_ID } from "./spot-network";
import type { SpotAsset } from "./spot-utils";

export function SpotValueSkeleton({ children }: { children: ReactNode }) {
  return <span className="trade-skeleton spot-value-skeleton" aria-hidden="true">{children}</span>;
}

const images: Record<string, { image: string } | undefined> = tokenImages.assets;
const usdcId = `${SPOT_NETWORK_ID}:classic:USDC:${SPOT_MAINNET_USDC_ISSUER}`;
const assets: SpotAsset[] = [
  { id: `${SPOT_NETWORK_ID}:native`, network: SPOT_NETWORK_ID, kind: "native", code: "XLM", name: "Stellar Lumens", icon: tokenImages.native.image },
  { id: usdcId, network: SPOT_NETWORK_ID, kind: "classic", code: "USDC", name: "USD Coin", issuer: SPOT_MAINNET_USDC_ISSUER, icon: images[usdcId]?.image },
];

// Blux is browser-only. Keep the real card structure in the server-rendered
// fallback, with placeholders only where a network response is needed.
export function SpotCardLoading() {
  return <div className="spot-workspace">
    <section className="trade-panel swap-ticket" aria-labelledby="swap-title">
      <div className="trade-panel-header swap-ticket-head"><div><h2 className="trade-panel-title" id="swap-title">Swap assets</h2><p className="trade-panel-subtitle">Choose the assets you want to exchange.</p></div>
        <button className="trade-icon-button" type="button" aria-label="Slippage settings" disabled><Icon name="sliders" size={17} /></button>
      </div>
      <div className="asset-fields">
        {assets.map((asset, index) => <Fragment key={asset.id}>
          {index === 1 && <button className="swap-direction-button" type="button" disabled aria-label="Reverse XLM and USDC"><Icon name="arrow-down" size={18} /></button>}
          <div className={`asset-amount-card${index ? " receive-card" : ""}`}>
          <div className="amount-card-meta"><span className="amount-card-label">{index ? "Receive" : "Pay"}</span><span className="amount-card-balance"><SpotValueSkeleton>Available 10,000.00 {asset.code}</SpotValueSkeleton></span></div>
          <div className="amount-card-main">
            {index ? <output className="amount-output is-unavailable" aria-label="Estimated receive amount">-</output>
              : <span className="amount-input-viewport"><input id="pay-amount" className="amount-input" aria-label="Pay" type="text" inputMode="decimal" value="" placeholder="0.00" disabled readOnly style={{ width: "5ch" }} /></span>}
            <button className="asset-select" type="button" disabled aria-label={`Choose ${index ? "receive" : "pay"} asset: ${asset.code}`}><SpotTokenIcon asset={asset} /><span className="asset-select-code">{asset.code}</span><Icon name="chevron-down" size={14} /></button>
          </div>
          <div className={`amount-card-footer${index ? " receive-supporting-copy" : ""}`}>
            <span>{asset.kind === "native" ? "Native" : `${asset.issuer!.slice(0, 6)}…${asset.issuer!.slice(-6)}`}</span>
            {index ? <span>Rate unavailable</span> : <button className="spot-max" type="button" disabled>MAX</button>}
          </div>
        </div></Fragment>)}
      </div>
      <div className="spot-quote-region"><section className="compact-route" aria-label="Execution route"><button className="compact-route-summary" type="button" disabled><span className="compact-route-copy"><span>Selected execution path</span><strong>Enter an amount</strong></span><span className="compact-route-view">View route<Icon name="chevron-down" size={15} /></span></button></section></div>
      <div className="spot-transaction-info">
        <div className="fee-disclosure"><button className="fee-summary-toggle" type="button" disabled aria-expanded="false"><span>Transaction details</span><Icon name="chevron-down" size={17} /></button></div>
      </div>
      <div className="swap-primary-wrap"><button className="trade-button trade-button--primary trade-button--lg trade-button--block wallet-connect-button" type="button" disabled>Loading swap…</button></div>
    </section>
  </div>;
}
