"use client";
import { useAssets } from "@bluxcc/react";
import type { Horizon } from "@stellar/stellar-sdk";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";
import { mergeSpotAssets, spotAsset, spotAssetSearch, spotError, type SpotAsset } from "./spot-utils";
import { SPOT_NETWORK, SPOT_NETWORK_ID } from "./spot-network";
import { SpotTokenIcon } from "./spot-token-icon";
import { useAccessibleOverlay } from "./use-accessible-overlay";

export function spotIssuerLabel(asset: SpotAsset) { return asset.kind === "native" ? "Native" : `${asset.issuer!.slice(0, 6)}…${asset.issuer!.slice(-6)}`; }
const PAGE_SIZE = 30;
export function SpotAssetSelector({ label, value, assets, onChange, canDiscover, disabled = false }: {
  label: string; value: SpotAsset; assets: SpotAsset[]; onChange: (asset: SpotAsset) => void;
  canDiscover: boolean; disabled?: boolean;
}) {
  const id = useId(); const ref = useRef<HTMLElement>(null); const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pages, setPages] = useState<{ query: string; cursor?: string; assets: SpotAsset[] }>({ query: "", assets: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  useAccessibleOverlay(open, close, ref);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const lookup = spotAssetSearch(debounced, assets);
  const searching = open && canDiscover && Boolean(lookup) && debounced === query.trim();
  const cursor = pages.query === debounced ? pages.cursor : undefined;
  const discovered = useAssets({ ...lookup, cursor, network: SPOT_NETWORK.passphrase, limit: PAGE_SIZE, order: "asc" }, {
    enabled: searching, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const found = useMemo(() => searching && !discovered.isError ? discovered.data?.response.records.flatMap((record: Horizon.ServerApi.AssetRecord) => {
      try { return [{ ...spotAsset(record.asset_code, record.asset_issuer, SPOT_NETWORK_ID), authRequired: record.flags.auth_required }]; }
      catch { return []; }
    }) ?? [] : [], [searching, discovered.data, discovered.isError]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return mergeSpotAssets(assets, pages.query === query.trim() ? pages.assets : [], found).filter(asset => asset.network === SPOT_NETWORK_ID).filter(asset => !needle ||
      [asset.code, asset.name, asset.issuer ?? "native", asset.code + ":" + asset.issuer].some(text => text.toLowerCase().includes(needle)));
  }, [assets, pages, found, query]);
  const records = searching && !discovered.isError ? discovered.data?.response.records : undefined;
  const nextCursor = records?.length === PAGE_SIZE ? records.at(-1)?.paging_token : undefined;
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus()); return () => cancelAnimationFrame(frame);
  }, [open]);
  function choose(asset: SpotAsset) { onChange(asset); close(); }
  function handleOptionKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % matches.length;
    if (event.key === "ArrowUp") next = (index - 1 + matches.length) % matches.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = matches.length - 1;
    if (next !== undefined) { event.preventDefault(); setActiveIndex(next); optionRefs.current[next]?.focus(); }
  }
  return <>
    <button className="asset-select" type="button" disabled={disabled} aria-label={`${label}: ${value.code}, ${value.name}, ${value.issuer ? `issuer ${value.issuer}` : "native"}`} title={value.issuer ?? "Native Stellar Lumens"}
      aria-controls={id} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setQuery(""); setDebounced(""); setPages({ query: "", assets: [] }); setActiveIndex(0); setOpen(true); }}
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
      <SpotTokenIcon asset={value} /><span className="asset-select-code">{value.code}</span><Icon name="chevron-down" size={15} />
    </button>
    {open && createPortal(<div className="trade-scrim asset-picker-scrim" data-spot-assets onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={ref} id={id} className="trade-modal asset-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="asset-picker-header"><div className="asset-picker-title-row"><h2 id={`${id}-title`}>Choose asset</h2><button className="trade-icon-button" type="button" aria-label="Close asset selection" onClick={close}><Icon name="close" size={18} /></button></div>
          <label className="trade-input-wrap asset-picker-search"><Icon name="search" size={17} /><span className="trade-sr-only">Search assets</span><input ref={searchRef} className="trade-input" type="search" value={query} placeholder="Search code, name or issuer" onChange={event => { const text = event.target.value; setQuery(text); setPages({ query: text.trim(), assets: [] }); setActiveIndex(0); }} onKeyDown={event => { if (event.key === "ArrowDown" && matches.length) { event.preventDefault(); setActiveIndex(0); optionRefs.current[0]?.focus(); } }} /></label>
          <div className="asset-picker-popular" role="group" aria-label="Curated assets">{assets.filter(asset => asset.curated).slice(0, 4).map(asset => <button key={asset.id} type="button" aria-pressed={asset.id === value.id} title={asset.issuer} onClick={() => choose(asset)}><SpotTokenIcon asset={asset} /><span>{asset.code}</span></button>)}</div>
        </div>
        <div className="asset-picker-list"><div role="listbox" aria-label={label}>{matches.map((asset, index) => <button key={asset.id} ref={element => { optionRefs.current[index] = element; }} className="asset-picker-option" type="button" role="option" aria-label={`${asset.code}, ${asset.name}, ${asset.issuer ? `issuer ${asset.issuer}` : "native"}`} aria-selected={asset.id === value.id} tabIndex={index === activeIndex ? 0 : -1} onFocus={() => setActiveIndex(index)} onKeyDown={event => handleOptionKey(event, index)} onClick={() => choose(asset)}>
          <SpotTokenIcon asset={asset} /><span className="asset-picker-option-copy"><span><strong>{asset.code}</strong><span>{asset.name}</span></span><small className="spot-selector-issuer">{spotIssuerLabel(asset)}</small></span>{asset.id === value.id && <Icon name="check" size={16} />}
        </button>)}</div>
          {query && (debounced !== query.trim() || (searching && discovered.isFetching)) && <div className="asset-picker-empty" role="status">Searching…</div>}
          {searching && discovered.isError && <div className="asset-picker-empty spot-selector-error" role="alert"><strong>Asset search unavailable</strong><span>{spotError(discovered.error)}</span><button type="button" className="spot-inline-action" onClick={() => void discovered.refetch({ cancelRefetch: false })}>Retry search</button></div>}
          {!matches.length && !discovered.isFetching && debounced === query.trim() && !discovered.isError && <div className="asset-picker-empty" role="status"><strong>No matching assets</strong><span>Try a full asset code or issuer address.</span></div>}
          {nextCursor && nextCursor !== cursor && <button className="spot-inline-action spot-assets-more" type="button" disabled={discovered.isFetching} onClick={() => setPages({ query: debounced, cursor: nextCursor, assets: mergeSpotAssets(pages.assets, found) })}>Load more assets</button>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
