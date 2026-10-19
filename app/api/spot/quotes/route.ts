const headers = { "Cache-Control": "no-store" };

export function GET() {
  return Response.json({ enabled: Boolean(process.env.LUMIX_API_URL?.trim()) }, { headers });
}

export async function POST(request: Request) {
  const apiUrl = process.env.LUMIX_API_URL?.trim();
  if (!apiUrl) return Response.json({ error: { message: "Soroban quotes are not configured." } }, { status: 503, headers });
  let body: string;
  try {
    body = await request.text();
    if (new TextEncoder().encode(body).length > 16_384) return Response.json({ error: { message: "Quote request is too large." } }, { status: 413, headers });
    JSON.parse(body);
  } catch {
    return Response.json({ error: { message: "Invalid quote request." } }, { status: 400, headers });
  }
  try {
    const base = new URL(apiUrl);
    const url = new URL(`${base.pathname.replace(/\/$/, "")}/v1/spot/quotes`, base);
    const response = await fetch(url, {
      method: "POST", body, headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(65_000)]),
    });
    const value = await response.json();
    return Response.json(value, { status: response.status, headers });
  } catch {
    return Response.json({ error: { message: "Soroban quotes are unavailable. Retry shortly." } }, { status: 503, headers });
  }
}
