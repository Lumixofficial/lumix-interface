import { Asset, Contract, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk/base";
import { SPOT_NETWORK_ID, spotNetwork, type SpotNetworkId } from "./spot-network";
import { spotAsset } from "./spot-utils";

// SAC instance storage carries the original classic asset. Re-derive its
// network-specific ID so a custom contract cannot impersonate an issued asset.
export function spotAssetFromSacEntry(address: string, encoded: string, network: SpotNetworkId) {
  const fail = () => { throw new Error("This contract is not a Stellar asset contract on this network."); };
  const entry = xdr.LedgerEntryData.fromXDR(encoded, "base64");
  if (entry.type !== "contractData") return fail();
  const data = entry.contractData;
  if (data.contract.type !== "scAddressTypeContract" || StrKey.encodeContract(data.contract.contractId.value) !== address
    || data.key.type !== "scvLedgerKeyContractInstance" || data.val.type !== "scvContractInstance") return fail();
  const instance = data.val.instance;
  if (instance.executable.type !== "contractExecutableStellarAsset") return fail();
  const stored = instance.storage?.find(pair => {
    const key = scValToNative(pair.key);
    return Array.isArray(key) && key.length === 1 && key[0] === "AssetInfo";
  });
  if (!stored) return fail();
  const info = scValToNative(stored.val) as [string, { asset_code: string; issuer: Uint8Array }?];
  let asset: Asset;
  if (Array.isArray(info) && info[0] === "Native" && info.length === 1) asset = Asset.native();
  else if (Array.isArray(info) && ["AlphaNum4", "AlphaNum12"].includes(info[0]) && info[1]
    && typeof info[1].asset_code === "string" && info[1].issuer instanceof Uint8Array && info[1].issuer.length === 32) {
    asset = new Asset(info[1].asset_code, StrKey.encodeEd25519PublicKey(info[1].issuer));
  } else return fail();
  if (asset.contractId(spotNetwork(network).passphrase) !== address) return fail();
  return spotAsset(asset.code, asset.isNative() ? undefined : asset.issuer, network);
}

export async function resolveSpotSac(address: string, network: SpotNetworkId = SPOT_NETWORK_ID, signal?: AbortSignal) {
  if (!StrKey.isValidContract(address)) throw new Error("Enter a valid Stellar contract address.");
  const config = spotNetwork(network);
  const key = new Contract(address).getFootprint().toXDR("base64");
  const response = await fetch(config.sorobanRpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLedgerEntries", params: { keys: [key] } }),
  });
  if (!response.ok) throw new Error(`Asset lookup on ${config.name} is unavailable. Retry shortly.`);
  const value = await response.json();
  if (value.error) throw new Error(`Asset lookup on ${config.name} failed. Retry shortly.`);
  const entry = value.result?.entries?.find((item: { key: string; xdr: string }) => item.key === key);
  if (!entry?.xdr) throw new Error(`No active Stellar asset contract found on ${config.name}. Check the address and network.`);
  return spotAssetFromSacEntry(address, entry.xdr, network);
}
