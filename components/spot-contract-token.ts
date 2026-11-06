import { Account, Address, Contract, StrKey, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk/base";
import { SPOT_NETWORK_ID, spotNetwork, type SpotNetworkId } from "./spot-network";
import { resolveSpotSac } from "./spot-sac";
import { SPOT_INDEXED_ASSETS } from "./spot-tokens";
import { SPOT_MAX_CONTRACT_AMOUNT, baseAccount, spotContractAsset, spotContractId, type SpotAsset } from "./spot-utils";

const simulationSource = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function readToken(address: string, method: string, args: xdr.ScVal[], network: SpotNetworkId, signal?: AbortSignal) {
  const config = spotNetwork(network);
  // Read-only simulation needs no wallet, signature, funded source or submission.
  const transaction = new TransactionBuilder(new Account(simulationSource, "0"), { fee: "100", networkPassphrase: config.passphrase })
    .addOperation(new Contract(address).call(method, ...args)).setTimeout(30).build();
  const response = await fetch(config.sorobanRpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method: "simulateTransaction", params: { transaction: transaction.toXDR() } }),
  });
  if (!response.ok) throw new Error(`Token lookup on ${config.name} is unavailable. Retry shortly.`);
  const value = await response.json();
  if (value.error || value.result?.error || value.result?.results?.length !== 1 || !value.result.results[0]?.xdr) {
    throw new Error(`Cannot read this token's ${method} on ${config.name}. Check the address and network, or retry shortly.`);
  }
  return scValToNative(xdr.ScVal.fromXDR(value.result.results[0].xdr, "base64")) as unknown;
}

export async function resolveSpotToken(address: string, network: SpotNetworkId = SPOT_NETWORK_ID, signal?: AbortSignal, assets = SPOT_INDEXED_ASSETS) {
  const normalized = address.trim().toUpperCase();
  if (!StrKey.isValidContract(normalized)) throw new Error("Enter a valid Stellar contract address.");
  const known = assets.find(asset => asset.network === network && spotContractId(asset) === normalized);
  if (known) return known;
  try { return await resolveSpotSac(normalized, network, signal); }
  catch (error) { if (signal?.aborted) throw error; }
  try {
    const [name, symbol, decimals] = await Promise.all(["name", "symbol", "decimals"].map(method => readToken(normalized, method, [], network, signal)));
    if (typeof name !== "string" || typeof symbol !== "string" || !name.trim() || !symbol.trim()
      || name.length > 128 || symbol.length > 128 || /[\u0000-\u001f\u007f]/.test(name + symbol) || typeof decimals !== "number") {
      throw new Error("Invalid SEP-41 metadata.");
    }
    return spotContractAsset(normalized, { name, symbol, decimals }, network);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`No active Stellar asset contract or SEP-41 token could be read on ${spotNetwork(network).name}. Check the address and network, or retry if RPC is unavailable.`);
  }
}

export async function readSpotContractBalance(asset: SpotAsset, owner: string, signal?: AbortSignal) {
  if (asset.kind !== "contract") throw new Error("Only contract tokens use SEP-41 balances.");
  const balance = await readToken(spotContractId(asset), "balance", [Address.fromString(baseAccount(owner)).toScVal()], asset.network, signal);
  if (typeof balance !== "bigint" || balance < BigInt(0) || balance > SPOT_MAX_CONTRACT_AMOUNT) throw new Error("The contract returned an invalid token balance.");
  return balance;
}
