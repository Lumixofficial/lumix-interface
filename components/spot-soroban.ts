import { Address, Transaction, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk/base";
import { availableAsset, balanceLine, BLUX_SWAP_FEE_PER_OPERATION, parseSpotAmount, parseSpotAssetAmount, spotAsset, spotContractId, spotEnvelopeHash, type SpotAccount } from "./spot-utils";
import { spotNetwork } from "./spot-network";
import type { SpotCandidate } from "./spot-api";

export const SOROBAN_SPOT_FEE_CAP = BigInt("10000000");
export function sorobanSpotValidation(account: SpotAccount, quote: Pick<SpotCandidate, "request" | "output">, reserve: bigint) {
  const { from, to, amount } = quote.request;
  if (from.unavailableReason || to.unavailableReason) return from.unavailableReason ?? to.unavailableReason;
  if (spotContractId(from) === spotContractId(to)) return "Choose two different assets.";
  const source = balanceLine(account, from), destination = balanceLine(account, to);
  if (from.kind === "contract" && account.contractBalances?.[spotContractId(from)] === undefined) return "Contract token balance is unavailable. Refresh and try again.";
  if (from.kind !== "contract" && (!source || source.is_authorized === false) || destination?.is_authorized === false) return "Check your token balance and issuer authorization.";
  if (parseSpotAssetAmount(amount, from) > availableAsset(account, from)) return "Insufficient available balance after open-offer liabilities.";
  const needsTrustline = to.kind === "classic" && !destination;
  if (needsTrustline && to.authRequired) return "This asset requires issuer authorization before it can be swapped.";
  if (destination && to.kind === "classic" && parseSpotAmount(destination.balance) + parseSpotAmount(destination.buying_liabilities ?? "0") + parseSpotAmount(quote.output) > parseSpotAmount(destination.limit ?? "922337203685.4775807")) return "Increase the receiving trustline limit in your wallet before using this route.";
  const entries = Math.max(0, 2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0) + Number(needsTrustline));
  const needed = BigInt(entries) * reserve + SOROBAN_SPOT_FEE_CAP + (needsTrustline ? BLUX_SWAP_FEE_PER_OPERATION : BigInt(0)) + (from.kind === "native" ? parseSpotAmount(amount) : BigInt(0));
  if (availableAsset(account, spotAsset("XLM", undefined, from.network)) < needed) return needsTrustline
    ? "Keep enough XLM for the additional 0.5 XLM trustline reserve, its fee, and the Soroban network fee limit (1 XLM)."
    : "Keep enough XLM for reserves and the Soroban network fee limit (1 XLM).";
}
function canonical(value: unknown): string {
  // Generic XDR decoding represents a void union as ["Soroswap"], while
  // the SDK/Blux native ABI input represents it as { tag: "Soroswap" }.
  return JSON.stringify(value, (_key, item) => _key === "protocol" && Array.isArray(item) && item.length === 1 && typeof item[0] === "string" ? { tag: item[0] } : item == null ? null : typeof item === "bigint" ? item.toString() : item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export function inspectSorobanSpotEnvelope(xdr: string, quote: SpotCandidate, now = Date.now()) {
  const candidate = quote.soroban;
  if (!candidate || Date.parse(candidate.expiresAt) <= now + 5000) throw new Error("This quote expired. Refresh and review the swap again.");
  const network = quote.request.from.network;
  const tx = TransactionBuilder.fromXDR(xdr, spotNetwork(network).passphrase);
  if (!(tx instanceof Transaction) || tx.source !== quote.request.account || tx.operations.length !== 1 || tx.memo.type !== "none") throw new Error("The Soroban transaction does not match the reviewed swap.");
  const operation = tx.operations[0];
  if (operation.type !== "invokeHostFunction" || operation.source || operation.func.type !== "hostFunctionTypeInvokeContract") throw new Error("Unexpected Soroban operation. Approval is blocked.");
  const call = operation.func.invokeContract;
  if (Address.fromScAddress(call.contractAddress).toString() !== candidate.txData.address
    || call.functionName.toString() !== candidate.txData.fn
    || canonical(call.args.map(scValToNative)) !== canonical(candidate.txData.args)) throw new Error("The aggregator call changed. Refresh before approving.");
  if (BigInt(tx.fee) > SOROBAN_SPOT_FEE_CAP) throw new Error("The simulated network fee exceeds the reviewed 1 XLM limit.");
  if (!tx.timeBounds || !Number(tx.timeBounds.maxTime)) throw new Error("The Soroban transaction has no expiry.");
  return { hash: spotEnvelopeHash(xdr, network), expiresAt: Math.min(Number(tx.timeBounds.maxTime) * 1000, Number(candidate.txData.args[0].deadline) * 1000) };
}
