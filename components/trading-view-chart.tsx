"use client";

import { useEffect, useRef, useState } from "react";
import { getTradingViewMarket } from "./trading-view-markets";

type ResolvedTheme = "dark" | "light";
type ChartStatus = "loading" | "ready" | "unavailable" | "unsupported";

function useResolvedTheme() {
  const [theme, setTheme] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function TradingViewChart({ asset }: { asset: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const theme = useResolvedTheme();
  const chartMarket = getTradingViewMarket(asset);
  const [status, setStatus] = useState<ChartStatus>(chartMarket ? "loading" : "unsupported");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let active = true;
    let ready = false;
    let loadTimeout: number | null = null;
    host.replaceChildren();

    if (!chartMarket) {
      iframeRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Mirror the lifecycle of the imperative third-party iframe, not React-owned DOM.
      setStatus("unsupported");
      return;
    }

    setStatus("loading");

    const mount = document.createElement("div");
    mount.className = "perp-chart-mount";
    const iframe = document.createElement("iframe");
    iframe.className = "perp-chart-frame";
    iframe.title = `${chartMarket.pair} TradingView chart`;
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("allowtransparency", "true");
    iframe.allow = "clipboard-write";
    const colors = theme === "light"
      ? { background: "#FFFFFF", grid: "rgba(23, 23, 26, 0.06)" }
      : { background: "#141416", grid: "rgba(255, 255, 255, 0.045)" };
    const configuration = {
      allow_symbol_change: false,
      autosize: true,
      backgroundColor: colors.background,
      calendar: false,
      compareSymbols: [],
      details: false,
      gridColor: colors.grid,
      hide_legend: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_volume: true,
      hotlist: false,
      interval: "240",
      locale: "en",
      save_image: false,
      studies: [],
      style: "1",
      support_host: "https://www.tradingview.com",
      symbol: chartMarket.symbol,
      theme,
      timezone: "Etc/UTC",
      watchlist: [],
      withdateranges: false,
      width: "100%",
      height: "100%",
      utm_source: window.location.hostname,
      utm_medium: "widget",
      utm_campaign: "advanced-chart",
      "page-uri": window.location.href,
    };
    const chartUrl = `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(configuration))}`;

    mount.append(iframe);
    host.replaceChildren(mount);
    iframeRef.current = iframe;

    const finishLoading = () => {
      if (!active || iframeRef.current !== iframe || !iframe.isConnected || !iframe.contentWindow) return;
      ready = true;
      setStatus("ready");
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
    };
    const failLoading = () => {
      if (active && iframeRef.current === iframe) setStatus("unavailable");
    };

    if (!iframe.contentWindow) {
      setStatus("unavailable");
    } else {
      iframe.addEventListener("load", finishLoading);
      iframe.addEventListener("error", failLoading);
      iframe.src = chartUrl;
    }

    loadTimeout = window.setTimeout(() => {
      if (active && iframeRef.current === iframe && !ready) setStatus("unavailable");
    }, 12_000);

    return () => {
      active = false;
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
      iframe.removeEventListener("load", finishLoading);
      iframe.removeEventListener("error", failLoading);
      if (iframeRef.current === iframe) iframeRef.current = null;
      iframe.src = "about:blank";
      mount.remove();
      if (host.contains(mount)) host.replaceChildren();
    };
  }, [attempt, chartMarket, theme]);

  const isUnsupported = status === "unsupported";
  const isUnavailable = status === "unavailable";

  return (
    <section className="perp-chart-panel" aria-label={`${asset} / USDC price chart`}>
      <div className="perp-chart-heading">
        <strong>{chartMarket?.pair ?? `${asset} / USDC`}</strong>
      </div>
      <div className="perp-chart-stage">
        <div ref={hostRef} className="perp-chart-host" />
        {status !== "ready" && (
          <div className={`perp-chart-state${status !== "loading" ? " is-unavailable" : ""}`} role="status">
            <span className="perp-chart-state-mark" aria-hidden="true" />
            <strong>
              {status === "loading"
                ? `Loading ${chartMarket?.pair ?? `${asset} / USDC`}`
                : isUnsupported
                  ? "USDC chart unavailable"
                  : "Chart unavailable"}
            </strong>
            <span>
              {status === "loading"
                ? "Connecting to TradingView"
                : isUnsupported
                  ? `TradingView has no verified USDC market configured for ${asset}. No USD or USDT substitute will be shown.`
                  : `${chartMarket?.pair ?? `${asset} / USDC`} could not be loaded. Order entry remains available.`}
            </span>
            {isUnavailable && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry chart</button>}
          </div>
        )}
      </div>
      <div className="perp-chart-attribution">Lumix orders use the app quote feed.</div>
    </section>
  );
}
