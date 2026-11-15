export type TrackerOptions = {
  site: string;
  endpoint: string;
  allowedRoutes: readonly string[];
  enabled: boolean;
  origin?: string;
};

export type Tracker = { pageview: () => void; cleanup: () => void };

// Pure configuration parsing can run on the server. Only the resulting public
// options cross the client boundary; the review reference is never serialized.
export function configureFrontendTracker(env: Record<string, string | undefined>): TrackerOptions {
  const origin = env.FRONT_VISITOR_ORIGIN ?? "";
  const endpoint = env.FRONT_VISITOR_ENDPOINT ?? "";
  const options = { site: "lumix-front", allowedRoutes: ["/spot"], origin, endpoint, enabled: false };
  const local = env.NODE_ENV === "development" && env.FRONT_VISITOR_MODE === "local-test";
  try {
    const page = new URL(origin), collector = new URL(endpoint);
    const loopback = (url: URL) => ["localhost", "127.0.0.1"].includes(url.hostname);
    const valid = page.origin === origin && collector.pathname === "/api/visitors" && !collector.search && !collector.hash && !collector.username && !collector.password;
    const permitted = local ? loopback(page) && loopback(collector) : page.protocol === "https:" && collector.protocol === "https:" && env.FRONT_VISITOR_MODE === "reviewed-exemption" && !!env.FRONT_VISITOR_REVIEW_ID;
    return { ...options, enabled: env.FRONT_VISITOR_ENABLED === "true" && valid && permitted };
  } catch { return options; }
}

// Module import is safe on the server. Browser state is only read on initialization.
const active = new Map<string, Tracker>();
export function initializeTracker(options: TrackerOptions): Tracker {
  const noop = { pageview() {}, cleanup() {} };
  if (typeof window === "undefined") return noop;
  const key = `${options.site}:${options.endpoint}`;
  if (!options.enabled || window.top !== window.self || (options.origin && location.origin !== options.origin)) {
    active.get(key)?.cleanup();
    return noop;
  }
  const existing = active.get(key);
  if (existing) return existing;
  let last: string | null = null;
  const pending = new Set<AbortController>();
  const blocked = () => {
    const navigatorWithGpc = navigator as Navigator & { globalPrivacyControl?: boolean };
    const privacyWindow = window as Window & { __lumixVisitorOptOut?: boolean; doNotTrack?: string };
    if (privacyWindow.__lumixVisitorOptOut || navigatorWithGpc.globalPrivacyControl || navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || privacyWindow.doNotTrack === "1") return true;
    try { return localStorage.getItem("lumix:visitor-opt-out") !== null; } catch { return true; }
  };
  const pageview = () => {
    const route = location.pathname.replace(/\/+$/, "") || "/";
    if (!options.allowedRoutes.includes(route)) { last = null; return; }
    if (blocked() || document.visibilityState !== "visible" || (document as Document & { prerendering?: boolean }).prerendering || route === last) return;
    last = route;
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      void fetch(options.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: 1, type: "pageview", site: options.site, route }),
        credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        keepalive: true, signal: controller.signal,
      }).catch(() => {}).finally(() => { clearTimeout(timer); pending.delete(controller); });
    } catch { clearTimeout(timer); pending.delete(controller); }
  };
  const privacyChanged = () => { if (blocked()) pending.forEach(controller => controller.abort()); };
  const cleanup = () => {
    window.removeEventListener("lumix:route", pageview);
    window.removeEventListener("lumix:privacy", privacyChanged);
    window.removeEventListener("storage", privacyChanged);
    document.removeEventListener("visibilitychange", pageview);
    pending.forEach(controller => controller.abort());
    active.delete(key);
  };
  const tracker = { pageview, cleanup };
  active.set(key, tracker);
  window.addEventListener("lumix:route", pageview);
  window.addEventListener("lumix:privacy", privacyChanged);
  window.addEventListener("storage", privacyChanged);
  document.addEventListener("visibilitychange", pageview);
  pageview();
  return tracker;
}
