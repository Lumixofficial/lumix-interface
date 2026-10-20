import { Address, Transaction, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk/base";
import { availableAsset, balanceLine, parseSpotAmount, spotAsset, spotEnvelopeHash, type SpotAccount } from "./spot-utils";
import { spotNetwork } from "./spot-network";
import type { SpotCandidate } from "./spot-api";

export const SOROBAN_SPOT_FEE_CAP = BigInt("10000000");
export function sorobanSpotValidation(account: SpotAccount, quote: SpotCandidate, reserve: bigint) {
  const { from, to, amount } = quote.request;
  const source = balanceLine(account, from), destination = balanceLine(account, to);
  if (!source || source.is_authorized === false || destination?.is_authorized === false) return "Check your token balance and issuer authorization.";
  if (parseSpotAmount(amount) > availableAsset(account, from)) return "Insufficient available balance after open-offer liabilities.";
  if (to.kind === "classic" && !destination) return `Add the ${to.code} trustline in your wallet before using a Soroban route.`;
  if (destination && to.kind === "classic" && parseSpotAmount(destination.balance) + parseSpotAmount(destination.buying_liabilities ?? "0") + parseSpotAmount(quote.output) > parseSpotAmount(destination.limit ?? "922337203685.4775807")) return "Increase the receiving trustline limit in your wallet before using this route.";
  const entries = Math.max(0, 2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0));
  const needed = BigInt(entries) * reserve + SOROBAN_SPOT_FEE_CAP + (from.kind === "native" ? parseSpotAmount(amount) : BigInt(0));
  if (availableAsset(account, spotAsset("XLM", undefined, from.network)) < needed) return "Keep enough XLM for reserves and the Soroban network fee limit (1 XLM).";
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
