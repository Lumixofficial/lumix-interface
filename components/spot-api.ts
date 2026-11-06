import { StrKey } from "@stellar/stellar-sdk/base";
import { SPOT_QUOTE_REFRESH_MS, minimumReceived, parseSpotAssetAmount, spotAssetDecimals, spotContractId, spotDecimal, spotRequestKey, spotRouteKey, type SpotQuote, type SpotRequest } from "./spot-utils";

export type SpotApiHop = {
  poolAddress: string; tokenIn: string; tokenOut: string; protocol: string; model: string;
  amountInRaw: string; amountOutRaw: string; feeRaw: string; feeBps: string; isEstimate: boolean;
};
export type SpotApiLeg = {
  routeId: string; amountIn: string; amountInRaw: string; amountOut: string; amountOutRaw: string;
  minimumReceived: string; minimumReceivedRaw: string; sharePct: string;
  path: string[]; pathSymbols: string[]; hops: SpotApiHop[];
};
export type SpotContractRequest = {
  sender: string; recipient: string | null; token_in: string; token_out: string;
  amount: string; limit: string; deadline: string; fee_bps: number;
  legs: { amount: string; limit: string; hops: { protocol: { tag: "Soroswap" | "Aquarius" | "Phoenix" | "Sushi" | "Comet" }; pool: string; token_in: string; token_out: string; output: string; limit: string; max_spread_bps: number | null; max_price: string | null }[] }[];
};
export type SpotApiQuote = {
  id: string; mode: "exact-in"; type: "single" | "split";
  amountIn: string; amountInRaw: string; amountOut: string; amountOutRaw: string;
  minimumReceived: string; minimumReceivedRaw: string; feeBps: number; feeAmountRaw: string;
  priceImpactPct: string | null; expiresAt: string; isEstimate: boolean; legs: SpotApiLeg[];
  txData: { address: string; fn: "swap_exact_in"; args: [SpotContractRequest] };
};
export type SpotApiResponse = {
  data: SpotApiQuote[];
  meta: {
    network: "pubnet" | "testnet"; mode: "exact-in"; amount: string; slippageBps: number;
    assetIn: { address: string; decimals: number }; assetOut: { address: string; decimals: number };
    quotedAt: string; warnings: string[]; networkFeesIncluded: false;
  };
};
export type SpotCandidate = SpotQuote & { id: string; source: "native" | "soroban"; soroban?: SpotApiQuote };
export const spotCandidateMinimum = (quote: SpotCandidate, bps: number) => quote.soroban?.minimumReceived ?? minimumReceived(quote.output, bps, spotAssetDecimals(quote.request.to));
const protocols: Record<string, string> = { soroswap: "Soroswap", aquarius: "Aquarius", phoenix: "Phoenix", sushi: "Sushi", comet: "Comet" };
// Quotes need a sender to encode txData. Public previews never have a wallet
// account and cannot execute; connecting changes the query key and sender.
const previewSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const quoteSender = (request: SpotRequest) => request.account ?? previewSender;
export const spotProtocol = (name: string) => protocols[name] ?? name;
export const formatSpotShare = (share: string) => Number(share) > 0 && Number(share) < 0.05
  ? "<0.1%" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(share))}%`;
export const spotQuoteProtocols = (quote: SpotCandidate) => quote.source === "native" ? "Stellar AMM / order book"
  : quote.soroban ? [...new Set(quote.soroban.legs.flatMap(leg => leg.hops.map(hop => spotProtocol(hop.protocol))))].join(" + ")
  : "Protocol unavailable";
export function spotApiBody(request: SpotRequest, bps: number) {
  const identity = (asset: SpotRequest["from"]) => asset.kind === "native" ? "native"
    : asset.kind === "contract" ? spotContractId(asset) : `${asset.code}:${asset.issuer}`;
  return {
    assetIn: identity(request.from), assetOut: identity(request.to),
    mode: "exact-in", amount: request.amount, sender: quoteSender(request),
    options: { slippageBps: bps, quoteLimit: 3, split: true, maxPoolAgeMs: 60_000 },
  };
}
export function validateSpotApiResponse(value: SpotApiResponse, request: SpotRequest, bps: number, passphrase: string, now = Date.now()) {
  const fail = () => { throw new Error("The Soroban quote does not match this swap. Refresh quotes."); };
  const token = (asset: SpotRequest["from"]) => spotContractId(asset, passphrase);
  const inputAmount = (amount: string) => parseSpotAssetAmount(amount, request.from);
  const outputAmount = (amount: string) => parseSpotAssetAmount(amount, request.to);
  const input = token(request.from), output = token(request.to);
  const expectedNetwork = request.from.network === "mainnet" ? "pubnet" : "testnet";
  if (!value?.meta || !Array.isArray(value.data) || value.data.length > 50 || value.meta.network !== expectedNetwork) {
    throw new Error("Soroban quotes are for a different Stellar network. Switch networks or refresh quotes.");
  }
  if (value.meta.mode !== "exact-in" || inputAmount(value.meta.amount) !== inputAmount(request.amount)
    || value.meta.slippageBps !== bps || value.meta.assetIn?.address !== input || value.meta.assetOut?.address !== output
    || value.meta.assetIn.decimals !== spotAssetDecimals(request.from) || value.meta.assetOut.decimals !== spotAssetDecimals(request.to) || !Array.isArray(value.meta.warnings)) fail();
  const ids = new Set<string>();
  for (const quote of value.data) {
    const call = quote.txData, args = call?.args?.[0];
    if (!quote.id || ids.has(quote.id) || quote.mode !== "exact-in" || !args || call.args.length !== 1
      || !StrKey.isValidContract(call.address) || call.fn !== "swap_exact_in"
      || args.sender !== quoteSender(request) || (args.recipient !== null && args.recipient !== quoteSender(request))
      || args.token_in !== input || args.token_out !== output || args.amount !== quote.amountInRaw
      || args.limit !== quote.minimumReceivedRaw || args.fee_bps !== quote.feeBps
      || inputAmount(quote.amountIn) !== inputAmount(request.amount) || inputAmount(quote.amountIn) !== BigInt(quote.amountInRaw)
      || outputAmount(quote.amountOut) !== BigInt(quote.amountOutRaw) || BigInt(quote.amountOutRaw) <= BigInt(0)
      || outputAmount(quote.minimumReceived) !== BigInt(quote.minimumReceivedRaw) || BigInt(quote.minimumReceivedRaw) <= BigInt(0)
      || BigInt(quote.minimumReceivedRaw) > BigInt(quote.amountOutRaw)
      || !Number.isFinite(Date.parse(quote.expiresAt)) || !/^\d+$/.test(args.deadline)
      || BigInt(args.deadline) !== BigInt(Math.floor(Date.parse(quote.expiresAt) / 1000))
      || !Array.isArray(quote.legs) || !quote.legs.length || quote.legs.length > 8 || args.legs?.length !== quote.legs.length
      || quote.type !== (quote.legs.length > 1 ? "split" : "single")) fail();
    ids.add(quote.id);
    let total = BigInt(0);
    quote.legs.forEach((leg, index) => {
      const execution = args.legs[index];
      if (execution.amount !== leg.amountInRaw || execution.limit !== leg.minimumReceivedRaw
        || !Array.isArray(leg.hops) || !leg.hops.length || leg.hops.length > 4 || execution.hops.length !== leg.hops.length
        || leg.path?.length !== leg.hops.length + 1 || leg.pathSymbols?.length !== leg.path.length
        || leg.path[0] !== input || leg.path.at(-1) !== output || !/^\d+(?:\.\d+)?$/.test(leg.sharePct)
        || Number(leg.sharePct) <= 0 || Number(leg.sharePct) > 100) fail();
      total += BigInt(leg.amountInRaw);
      leg.hops.forEach((hop, hopIndex) => {
        const bound = execution.hops[hopIndex];
        if (!protocols[hop.protocol] || !StrKey.isValidContract(hop.poolAddress) || bound.pool !== hop.poolAddress
          || !bound.protocol || typeof bound.protocol !== "object" || Array.isArray(bound.protocol) || Object.keys(bound.protocol).length !== 1 || bound.protocol.tag !== protocols[hop.protocol]
          || bound.token_in !== hop.tokenIn || bound.token_out !== hop.tokenOut
          || hop.tokenIn !== leg.path[hopIndex] || hop.tokenOut !== leg.path[hopIndex + 1]) fail();
      });
    });
    if (total !== BigInt(quote.amountInRaw)) fail();
  }
  return { ...value, data: value.data.filter(quote => Date.parse(quote.expiresAt) > now + 5000) };
}
export function spotApiRefreshMs(value: SpotApiResponse | undefined, now = Date.now()) {
  if (!value?.data.length) return SPOT_QUOTE_REFRESH_MS;
  const expires = Math.min(...value.data.map(quote => Date.parse(quote.expiresAt)));
  return Math.max(1000, Math.min(SPOT_QUOTE_REFRESH_MS, expires - now - 10_000));
}
export async function fetchSpotApiEnabled(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch("/api/spot/quotes", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Quote configuration is unavailable.");
  const value = await response.json();
  return value.enabled === true;
}
export async function fetchSpotApiQuotes(request: SpotRequest, bps: number, passphrase: string, signal?: AbortSignal) {
  const response = await fetch("/api/spot/quotes", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    signal, body: JSON.stringify(spotApiBody(request, bps)),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? "Soroban quotes are unavailable. Retry shortly.");
  return validateSpotApiResponse(value, request, bps, passphrase);
}
export function spotCandidates(native: SpotQuote | SpotQuote[] | undefined, api: SpotApiResponse | undefined, request: SpotRequest, bps = 30, now = Date.now()): SpotCandidate[] {
  const key = spotRequestKey(request);
  const outputAmount = (amount: string) => parseSpotAssetAmount(amount, request.to);
  const bestNative = (request.from.kind === "contract" || request.to.kind === "contract" ? [] : Array.isArray(native) ? native : native ? [native] : []).filter(quote => quote.key === key)
    .reduce<SpotQuote | undefined>((best, quote) => !best || outputAmount(quote.output) > outputAmount(best.output) ? quote : best, undefined);
  // Horizon paths share the same native operation and do not identify a
  // Soroban protocol. Contribute only their best quote to venue comparison.
  const quotes: SpotCandidate[] = bestNative ? [{ ...bestNative, source: "native", id: `native:${spotRouteKey(bestNative)}` }] : [];
  for (const quote of api?.data ?? []) {
    if (Date.parse(quote.expiresAt) <= now + 5000 || quote.txData.args[0].sender !== quoteSender(request)) continue;
    quotes.push({ key, request, output: spotDecimal(BigInt(quote.amountOutRaw), spotAssetDecimals(request.to)), route: [request.from, request.to], source: "soroban", id: `soroban:${quote.id}`, soroban: quote });
  }
  return quotes.sort((a, b) => {
    const delta = outputAmount(b.output) - outputAmount(a.output)
      || outputAmount(spotCandidateMinimum(b, bps)) - outputAmount(spotCandidateMinimum(a, bps));
    return delta > BigInt(0) ? 1 : delta < BigInt(0) ? -1 : 0;
  }).slice(0, 3);
}
