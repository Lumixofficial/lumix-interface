import { spotBackendUrl } from "../../backend";

const headers = { "Cache-Control": "no-store" };
const maxBodyBytes = 32_768;

export async function POST(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return Response.json({ error: { message: "Expected a JSON swap record." } }, { status: 415, headers });
  }
  let body: string;
  try {
    if (Number(request.headers.get("content-length")) > maxBodyBytes) return Response.json({ error: { message: "Swap record is too large." } }, { status: 413, headers });
    body = await request.text();
    if (new TextEncoder().encode(body).length > maxBodyBytes) return Response.json({ error: { message: "Swap record is too large." } }, { status: 413, headers });
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.txHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.txHash)
      || typeof value.sender !== "string" || !/^[GM][A-Z2-7]{55,68}$/.test(value.sender)
      || !["STELLAR_NATIVE", "CONTRACT_AGGREGATOR"].includes(value.venue)
      || (value.route !== undefined && (!value.route || typeof value.route !== "object" || Array.isArray(value.route)))) {
      return Response.json({ error: { message: "Invalid swap record." } }, { status: 400, headers });
    }
  } catch {
    return Response.json({ error: { message: "Invalid swap record." } }, { status: 400, headers });
  }
  try {
    const response = await fetch(spotBackendUrl("/v1/spot/swaps/record"), {
      method: "POST", body,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { ...headers, ...(response.headers.has("content-type") ? { "Content-Type": response.headers.get("content-type")! } : {}) },
    });
  } catch {
    return Response.json({ error: { message: "Swap reporting is unavailable. The submitted swap is unaffected." } }, { status: 503, headers });
  }
}
