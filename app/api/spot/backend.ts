// Read server configuration per request, not from the browser's bundled env.
export function spotBackendUrl(path: string) {
  const base = new URL(process.env.LUMIX_API_URL?.trim() || process.env.API_URL?.trim() || "http://127.0.0.1:8080");
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("Invalid backend protocol.");
  return new URL(`${base.pathname.replace(/\/+$/, "")}${path}`, base);
}
