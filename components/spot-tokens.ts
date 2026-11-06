import { StrKey } from "@stellar/stellar-sdk/base";
import indexed from "./spot-indexed-tokens.json";
import { SPOT_NETWORK_ID, type SpotNetworkId } from "./spot-network";
import { spotAsset, spotContractAsset, spotContractId, type SpotAsset } from "./spot-utils";

const text = (value: unknown) => typeof value === "string" && value.trim().length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined;

// The API currently exposes quotes, not a token catalog. Keep the indexer's
// public bootstrap metadata local; discovery must not depend on RPC uptime.
export function spotIndexedAsset(value: unknown, network: SpotNetworkId = SPOT_NETWORK_ID): SpotAsset | undefined {
  if (!value || typeof value !== "object") return undefined;
  const token = value as Record<string, unknown>;
  const address = typeof token.address === "string" ? token.address.trim().toUpperCase() : "";
  if (!StrKey.isValidContract(address) || typeof token.decimals !== "number"
    || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 38) return undefined;
  const symbol = text(token.symbol), name = text(token.name), assetCode = text(token.assetCode);
  try {
    if (token.type === "native" || token.type === "classic") {
      const asset = token.type === "native" ? spotAsset("XLM", undefined, network)
        : spotAsset(assetCode ?? "", typeof token.issuer === "string" ? token.issuer : "", network);
      if (token.decimals !== 7 || spotContractId(asset) !== address) return undefined;
      return { ...asset, address, symbol: symbol || asset.code, assetCode: assetCode || asset.code, decimals: 7,
        name: asset.curated ? asset.name : name || asset.name };
    }
    if (token.type !== "contract") return undefined;
    return spotContractAsset(address, { symbol, assetCode, name, decimals: token.decimals }, network);
  } catch { return undefined; }
}

export const SPOT_INDEXED_ASSETS = indexed.tokens.flatMap(token => {
  const asset = spotIndexedAsset(token, "mainnet");
  return asset ? [asset] : [];
});

export function spotAssetMatches(asset: SpotAsset, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const fields = [asset.code, asset.symbol, asset.assetCode, asset.name, asset.issuer, asset.address,
    asset.kind === "native" ? "native" : asset.kind === "classic" ? `${asset.code}:${asset.issuer}` : undefined];
  if (fields.some(value => typeof value === "string" && value.toLowerCase().includes(needle))) return true;
  try { return spotContractId(asset).toLowerCase().includes(needle); }
  catch { return false; }
}
