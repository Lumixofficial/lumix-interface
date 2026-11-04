import type { SpotCandidate } from "./spot-api";

export type RecordSwapPayload = {
  txHash: string;
  sender: string;
  venue: "STELLAR_NATIVE" | "CONTRACT_AGGREGATOR";
  route?: Record<string, unknown>;
};

export function spotSwapRecordPayload(txHash: string, quote: SpotCandidate): RecordSwapPayload | undefined {
  if (quote.request.from.network !== "mainnet" || quote.request.to.network !== "mainnet"
    || !quote.request.account || !/^[a-f0-9]{64}$/i.test(txHash)) return;
  return {
    txHash,
    sender: quote.request.account,
    venue: quote.source === "native" ? "STELLAR_NATIVE" : "CONTRACT_AGGREGATOR",
    route: quote.source === "native"
      ? { path: quote.route.map(({ id, code, issuer }) => ({ id, code, issuer })) }
      : { type: quote.soroban?.type, legs: quote.soroban?.legs ?? [] },
  };
}

// Best effort only. Callers must not await attribution before confirming a swap.
export async function recordSpotSwap(payload: RecordSwapPayload) {
  try {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:8080").replace(/\/+$/, "");
    console.log(`[Swap Attribution] Reporting ${payload.venue} swap ${payload.txHash} to API...`);
    const response = await fetch(`${apiUrl}/v1/spot/swaps/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, route: payload.route ?? {} }),
      credentials: "omit",
      keepalive: true,
      signal: AbortSignal.timeout(10_000),
    });
    console.log("[Swap Attribution] Response:", response.status);
    if (response.status !== 202) console.error("[Swap Attribution] Error:", `Expected 202 Accepted; received HTTP ${response.status}.`);
  } catch (error) {
    // Log the failure, not the sender, route, signed envelope or response body.
    console.error("[Swap Attribution] Error:", error instanceof Error ? error.message : "Request failed. Check the Network panel for connection, CORS or timeout errors.");
  }
}
