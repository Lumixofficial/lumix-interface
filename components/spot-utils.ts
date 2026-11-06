import { Asset, StrKey, extractBaseAddress, Transaction, TransactionBuilder } from "@stellar/stellar-sdk/base";
import { circleTestnetUsdc, circleTestnetEurc, mainnetOnly } from "./spot-verified-assets.json";
import tokenImages from "./spot-token-images.json";
import { SPOT_MAINNET_EURC_ISSUER, SPOT_MAINNET_USDC_ISSUER, SPOT_NETWORK_ID, spotNetwork, type SpotNetworkId } from "./spot-network";

export const SPOT_TESTNET = "Test SDF Network ; September 2015";
export const SPOT_SCALE = BigInt("10000000");
export const SPOT_MAX_AMOUNT = BigInt("9223372036854775807");
export const SPOT_MAX_CONTRACT_AMOUNT = (BigInt(1) << BigInt(127)) - BigInt(1);
// Native swap fee cap in stroops per operation.
export const BLUX_SWAP_FEE_PER_OPERATION = BigInt("100000");
export const SPOT_QUOTE_REFRESH_MS = 30_000;
export const CIRCLE_TESTNET_USDC = circleTestnetUsdc.issuer;

export function spotLocalTokenImage(network: "testnet" | "mainnet", code: string, issuer?: string) {
  if (!issuer) return code === "XLM" ? tokenImages.native.image : undefined;
  const images: Record<string, { image: string }> = tokenImages.assets;
  return images[`${network}:classic:${code}:${issuer}`]?.image;
}
export function spotHomeDomain(value: unknown) {
  if (typeof value !== "string") return undefined;
  const domain = value.trim().toLowerCase();
  return domain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain) ? domain : undefined;
}
export function spotCurrencyImage(metadata: unknown, asset: Pick<SpotAsset, "code" | "issuer">) {
  if (!asset.issuer || !metadata || typeof metadata !== "object" || !("CURRENCIES" in metadata) || !Array.isArray(metadata.CURRENCIES)) return undefined;
  const currency = metadata.CURRENCIES.find(entry => entry && entry.code === asset.code && entry.issuer === asset.issuer);
  if (typeof currency?.image !== "string") return undefined;
  try {
    const url = new URL(currency.image);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export type SpotAsset = {
  id: string; network: SpotNetworkId; kind: "native" | "classic" | "contract";
  code: string; issuer?: string; name: string; icon?: string; curated?: boolean;
  address?: string; symbol?: string; assetCode?: string | null; decimals?: number;
  authRequired?: boolean;
  unavailableReason?: string;
};
export type SpotBalance = {
  asset_type: string; balance: string; asset_code?: string; asset_issuer?: string;
  selling_liabilities?: string; buying_liabilities?: string; limit?: string; is_authorized?: boolean;
};
export type SpotAccount = {
  account_id: string; balances: SpotBalance[]; subentry_count: number;
  num_sponsoring?: number; num_sponsored?: number;
  contractBalances?: Record<string, bigint>;
};
export type SpotPathRecord = {
  source_asset_type: string; source_asset_code?: string; source_asset_issuer?: string; source_amount: string;
  destination_asset_type: string; destination_asset_code?: string; destination_asset_issuer?: string; destination_amount: string;
  path: { asset_type: string; asset_code?: string; asset_issuer?: string }[];
};
export type SpotRequest = { from: SpotAsset; to: SpotAsset; amount: string; account?: string };
export type SpotQuote = { key: string; request: SpotRequest; output: string; route: SpotAsset[] };
export type SpotReceipt = { hash: string; received: string; fee: string; ledger: number };

export function spotAsset(code: string, issuer?: string, network: SpotNetworkId = "testnet"): SpotAsset {
  if (!issuer) {
    if (code !== "XLM") throw new Error("Only native XLM can omit an issuer.");
    return { id: `${network}:native`, network, kind: "native", code: "XLM", name: "Stellar Lumens", icon: spotLocalTokenImage(network, "XLM"), curated: true };
  }
  if (!/^[a-zA-Z0-9]{1,12}$/.test(code) || !StrKey.isValidEd25519PublicKey(issuer)) throw new Error("Enter a classic asset code and a valid full Stellar issuer address.");
  const verified = (network === "testnet" ? [circleTestnetUsdc, circleTestnetEurc] : Object.values(tokenImages.assets).filter(asset => asset.network === "mainnet")).find(asset => asset.code === code && asset.issuer === issuer);
  // Recognize copied Mainnet trustlines without presenting them as Testnet tokens.
  // Their official artwork is used only on disabled, explicitly labelled entries.
  const mainnet = network === "testnet" ? mainnetOnly.find(asset => asset.code === code && asset.issuer === issuer) : undefined;
  return { id: `${network}:classic:${code}:${issuer}`, network, kind: "classic", code, issuer,
    name: verified?.name ?? mainnet?.name ?? code, icon: spotLocalTokenImage(network, code, issuer) ?? verified?.image ?? mainnet?.image,
    curated: Boolean(verified), unavailableReason: mainnet?.reason };
}
export function spotContractAsset(address: string, metadata: { symbol?: string | null; assetCode?: string | null; name?: string | null; decimals: number }, network: SpotNetworkId = SPOT_NETWORK_ID): SpotAsset {
  if (!StrKey.isValidContract(address)) throw new Error("Enter a valid Stellar contract address.");
  spotScale(metadata.decimals);
  const symbol = metadata.symbol?.trim() || undefined;
  const assetCode = metadata.assetCode?.trim() || null;
  const code = symbol || assetCode || `${address.slice(0, 6)}…${address.slice(-6)}`;
  return { id: `${network}:contract:${address}`, network, kind: "contract", address,
    code, symbol, assetCode, name: metadata.name?.trim() || code, decimals: metadata.decimals };
}
export function spotAssetDecimals(asset: SpotAsset) {
  if (asset.kind !== "contract") return 7;
  if (asset.decimals === undefined) throw new Error("This contract token has no decimals metadata.");
  spotScale(asset.decimals);
  return asset.decimals;
}
export function spotContractId(asset: SpotAsset, passphrase: string = spotNetwork(asset.network).passphrase) {
  if (asset.kind === "contract") {
    if (!asset.address || !StrKey.isValidContract(asset.address)) throw new Error("This token has no valid contract address.");
    return asset.address;
  }
  return (asset.kind === "native" ? Asset.native() : new Asset(asset.code, asset.issuer!)).contractId(passphrase);
}
export function spotAssetReference(asset: SpotAsset) {
  return asset.kind === "native" ? "Native Stellar Lumens" : asset.kind === "contract" ? asset.address ?? "" : asset.issuer ?? "";
}
export function bluxAsset(asset: SpotAsset) {
  if (asset.kind === "contract") throw new Error("Contract tokens require a Soroban route.");
  return asset.kind === "native" ? "xlm" : `${asset.code}:${asset.issuer}`;
}
export function baseAccount(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidMed25519PublicKey(address)) throw new Error("The wallet did not provide a valid Stellar account.");
  return extractBaseAddress(address);
}
function spotScale(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new Error("Token decimals must be between 0 and 38.");
  return BigInt(10) ** BigInt(decimals);
}
export function parseSpotAmount(value: string, decimals = 7, maximum = SPOT_MAX_AMOUNT): bigint {
  const scale = spotScale(decimals);
  const pattern = decimals ? new RegExp(`^(?:\\d+(?:\\.\\d{0,${decimals}})?|\\.\\d{1,${decimals}})$`) : /^\d+\.?$/;
  if (typeof value !== "string" || value.length > 80 || !pattern.test(value)) throw new Error(`Enter an amount with up to ${decimals} decimal places.`);
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole || "0") * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units > maximum) throw new Error("This amount exceeds Stellar’s maximum.");
  return units;
}
export function parseSpotAssetAmount(value: string, asset: SpotAsset) {
  return parseSpotAmount(value, spotAssetDecimals(asset), asset.kind === "contract" ? SPOT_MAX_CONTRACT_AMOUNT : SPOT_MAX_AMOUNT);
}
export function spotDecimal(units: bigint, decimals = 7) {
  const scale = spotScale(decimals);
  const negative = units < BigInt("0"); const absolute = negative ? -units : units;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / scale}${fraction ? `.${fraction}` : ""}`;
}
export function formatSpotAmount(value: string | bigint, decimals = 7) {
  try {
    const scale = spotScale(decimals);
    const units = typeof value === "bigint" ? value : parseSpotAmount(value, decimals, SPOT_MAX_CONTRACT_AMOUNT);
    const absolute = units < BigInt("0") ? -units : units;
    const cents = (absolute * BigInt(100) + scale / BigInt(2)) / scale;
    const whole = (cents / BigInt("100")).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${units < BigInt("0") ? "−" : ""}${whole}.${(cents % BigInt("100")).toString().padStart(2, "0")}`;
  } catch { return "—"; }
}
// Quote limits must stay visible down to one stroop and must never be rounded
// up beyond the amount the transaction actually protects.
export function formatSpotQuoteAmount(value: string | bigint, minimumFractionDigits: 2 | 7 = 2, decimals = 7) {
  try {
    const [whole, fraction = ""] = spotDecimal(typeof value === "bigint" ? value : parseSpotAmount(value, decimals, SPOT_MAX_CONTRACT_AMOUNT), decimals).split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(minimumFractionDigits, "0")}`;
  } catch { return "—"; }
}
export function formatSpotFee(value: string | bigint) {
  const units = typeof value === "bigint" ? value : parseSpotAmount(value);
  return units > BigInt("0") && units < BigInt("100000") ? "<0.01" : formatSpotAmount(units);
}
export function parseSlippage(value: string) {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isInteger(bps) && bps >= 1 && bps <= 500 ? bps : undefined;
}
export function spotAssetSearch(query: string, assets: SpotAsset[]) {
  const text = query.trim();
  if (StrKey.isValidEd25519PublicKey(text)) return { forIssuer: text };
  const [code, issuer, extra] = text.split(":");
  if (extra !== undefined) return undefined;
  if (issuer && /^[a-zA-Z0-9]{1,12}$/.test(code) && StrKey.isValidEd25519PublicKey(issuer)) return { forCode: code.toUpperCase(), forIssuer: issuer };
  const known = assets.find(asset => [asset.name, asset.code].some(value => value.toLowerCase() === text.toLowerCase()));
  if (known?.kind === "classic") return { forCode: known.code.toUpperCase() };
  return /^[a-zA-Z0-9]{1,12}$/.test(text) ? { forCode: text.toUpperCase() } : undefined;
}
export function slippageFraction(bps: number) {
  if (!Number.isInteger(bps) || bps < 1 || bps > 500) throw new Error("Choose slippage between 0.01% and 5%.");
  const fraction = bps / 10_000;
  // Keep callers that use a decimal fraction from weakening integer limits
  // through binary rounding. Envelope minimums use integer basis points.
  return 1 - fraction < (10_000 - bps) / 10_000 ? fraction - Number.EPSILON : fraction;
}
export function minimumReceived(output: string, bps: number, decimals = 7) {
  slippageFraction(bps);
  const minimum = parseSpotAmount(output, decimals, SPOT_MAX_CONTRACT_AMOUNT) * BigInt(10_000 - bps) / BigInt("10000");
  return spotDecimal(minimum < BigInt("1") ? BigInt("1") : minimum, decimals);
}
export function spotRate(output: string, input: string, outputDecimals = 7, inputDecimals = 7) {
  const denominator = parseSpotAmount(input, inputDecimals, SPOT_MAX_CONTRACT_AMOUNT) * spotScale(outputDecimals);
  const numerator = parseSpotAmount(output, outputDecimals, SPOT_MAX_CONTRACT_AMOUNT) * spotScale(inputDecimals);
  return denominator > BigInt("0") ? formatSpotAmount(numerator * SPOT_SCALE / denominator) : "—";
}
export function spotRequestKey(request: SpotRequest) {
  return [spotNetwork(request.from.network).passphrase, request.account ?? "public", request.from.id, request.to.id, request.amount,
    ...(request.from.kind === "contract" || request.to.kind === "contract" ? [spotAssetDecimals(request.from), spotAssetDecimals(request.to)] : [])].join("|");
}
export function balanceLine(account: SpotAccount, asset: SpotAsset) {
  if (asset.kind === "contract") return undefined;
  return account.balances.find(line => asset.kind === "native" ? line.asset_type === "native"
    : (line.asset_type === "credit_alphanum4" || line.asset_type === "credit_alphanum12") && line.asset_code === asset.code && line.asset_issuer === asset.issuer);
}
export function availableAsset(account: SpotAccount, asset: SpotAsset) {
  if (asset.kind === "contract") return account.contractBalances?.[spotContractId(asset)] ?? BigInt(0);
  const line = balanceLine(account, asset);
  if (!line || line.is_authorized === false) return BigInt("0");
  const balance = parseSpotAmount(line.balance) - parseSpotAmount(line.selling_liabilities ?? "0");
  return balance > BigInt("0") ? balance : BigInt("0");
}
export function trustlineChange(account: SpotAccount, to: SpotAsset, output?: string) {
  if (to.kind !== "classic") return { operations: 1, newEntries: 0 };
  const line = balanceLine(account, to);
  if (!line) return { operations: 2, newEntries: 1 };
  const capacity = parseSpotAmount(line.limit ?? "922337203685.4775807") - parseSpotAmount(line.balance) - parseSpotAmount(line.buying_liabilities ?? "0");
  return { operations: output && parseSpotAmount(output) > capacity ? 2 : 1, newEntries: 0 };
}
export function spotRequirements(account: SpotAccount, from: SpotAsset, to: SpotAsset, reserve: bigint, output?: string) {
  const { operations, newEntries } = trustlineChange(account, to, output);
  const entries = 2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0) + newEntries;
  const minimumBalance = BigInt(Math.max(0, entries)) * reserve;
  const fee = BLUX_SWAP_FEE_PER_OPERATION * BigInt(operations);
  const native = availableAsset(account, spotAsset("XLM"));
  const freeNative = native - minimumBalance - fee;
  const max = from.kind === "native" ? freeNative : availableAsset(account, from);
  return { operations, newEntries, minimumBalance, fee, max: max > BigInt("0") ? max : BigInt("0"), enoughXlm: freeNative >= BigInt("0") };
}
function pathAsset(record: { asset_type: string; asset_code?: string; asset_issuer?: string }, network: SpotNetworkId = "testnet") {
  if (!["native", "credit_alphanum4", "credit_alphanum12"].includes(record.asset_type)) throw new Error("The quote contains an unsupported asset type.");
  return record.asset_type === "native" ? spotAsset("XLM", undefined, network) : spotAsset(record.asset_code ?? "", record.asset_issuer, network);
}
function validSpotPaths(records: SpotPathRecord[], request: SpotRequest): SpotPathRecord[] {
  const valid = records.filter(record => {
    try {
      return pathAsset({ asset_type: record.source_asset_type, asset_code: record.source_asset_code, asset_issuer: record.source_asset_issuer }, request.from.network).id === request.from.id
        && pathAsset({ asset_type: record.destination_asset_type, asset_code: record.destination_asset_code, asset_issuer: record.destination_asset_issuer }, request.to.network).id === request.to.id
        && parseSpotAmount(record.source_amount) === parseSpotAmount(request.amount) && parseSpotAmount(record.destination_amount) > BigInt("0")
        && Array.isArray(record.path) && record.path.length <= 5 && record.path.every(asset => Boolean(pathAsset(asset, request.from.network)));
    } catch { return false; }
  });
  return valid.sort((a, b) => {
    const delta = parseSpotAmount(b.destination_amount) - parseSpotAmount(a.destination_amount);
    return delta > BigInt(0) ? 1 : delta < BigInt(0) ? -1 : 0;
  });
}
export function chooseSpotPath(records: SpotPathRecord[], request: SpotRequest): SpotPathRecord | undefined {
  return validSpotPaths(records, request)[0];
}
export const spotRouteKey = (quote: SpotQuote) => quote.route.map(asset => asset.id).join(">");
export function quotesFromPaths(records: SpotPathRecord[], request: SpotRequest): SpotQuote[] {
  const seen = new Set<string>();
  const valid = validSpotPaths(records, request);
  if (records.length && !valid.length) throw new Error("The quote did not match the selected assets or amount. Change the amount to request a new quote.");
  return valid.flatMap(path => {
    const quote = { key: spotRequestKey(request), request, output: spotDecimal(parseSpotAmount(path.destination_amount)),
      route: [request.from, ...path.path.map(asset => pathAsset(asset, request.from.network)), request.to] };
    const key = spotRouteKey(quote);
    if (seen.has(key)) return [];
    seen.add(key);
    return [quote];
  });
}
export function selectSpotPath(records: SpotPathRecord[], quote: SpotQuote): SpotPathRecord {
  const path = validSpotPaths(records, quote.request).find(path => {
    const candidate = quoteFromPaths([path], quote.request);
    return candidate && spotRouteKey(candidate) === spotRouteKey(quote);
  });
  if (!path) throw new Error("Your selected Stellar path is no longer available. Refresh quotes and choose another path.");
  return path;
}
export function quoteFromPaths(records: SpotPathRecord[], request: SpotRequest): SpotQuote | null {
  const path = chooseSpotPath(records, request);
  if (records.length && !path) throw new Error("The quote did not match the selected assets or amount. Change the amount to request a new quote.");
  return path ? { key: spotRequestKey(request), request, output: spotDecimal(parseSpotAmount(path.destination_amount)),
    route: [request.from, ...path.path.map(asset => pathAsset(asset, request.from.network)), request.to] } : null;
}
export function spotValidation(account: SpotAccount, request: SpotRequest, reserve: bigint, output?: string) {
  if (request.from.unavailableReason || request.to.unavailableReason) return request.from.unavailableReason ?? request.to.unavailableReason;
  if (request.from.id === request.to.id) return "Choose two different assets.";
  if (request.from.kind === "contract" || request.to.kind === "contract") return "Contract tokens require a Soroban route.";
  const amount = parseSpotAmount(request.amount);
  if (amount === BigInt("0")) return "Enter an amount greater than zero.";
  const source = balanceLine(account, request.from); const destination = balanceLine(account, request.to);
  if (!source) return `You have no ${request.from.code} balance with this issuer.`;
  if (source.is_authorized === false || destination?.is_authorized === false || (!destination && request.to.authRequired)) return "This asset requires issuer authorization before it can be swapped.";
  const requirements = spotRequirements(account, request.from, request.to, reserve, output);
  if (!requirements.enoughXlm) return "Insufficient XLM for the account reserve, transaction fee and receiving trustline.";
  if (amount > requirements.max) return request.from.kind === "native" ? "Keep enough XLM for account reserves and the transaction fee. Use Max." : "Insufficient available balance after open-offer liabilities.";
  return undefined;
}
export function spotError(error: unknown) {
  const object = error as { message?: string; response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } };
  const codes = object?.response?.data?.extras?.result_codes;
  if (codes) {
    const all = [codes.transaction, ...(codes.operations ?? [])].filter(Boolean).join(", ");
    if (all.includes("underfunded")) return "Insufficient balance after reserves, fees or open offers.";
    if (all.includes("low_reserve")) return "Insufficient XLM for the receiving trustline reserve.";
    if (all.includes("under_dest_min")) return "The market moved below your minimum received. Refresh the quote.";
    if (all.includes("line_full")) return "The receiving trustline cannot accept this amount. Check its limit and open offers.";
    if (all.includes("no_trust") || all.includes("not_authorized")) return "The asset trustline needs issuer authorization.";
    if (all.includes("too_few_offers")) return "No route available for this amount.";
    if (all.includes("insufficient_fee")) return "Stellar rejected the fee limit. Try again later.";
    return `Stellar rejected the transaction (${all}).`;
  }
  const message = object?.message ?? (typeof error === "string" ? error : "The Stellar request failed. Try again.");
  return message.replace(/\bBlux(?:’s|'s)?\s*:?\s*/gi, "");
}
export function walletRejected(error: unknown) {
  const codes = (error as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras?.result_codes;
  if (codes) return false;
  return /user.*(?:reject|denied|declined|cancel)|request.*(?:reject|declined)|approval.*(?:denied|cancel)|cancelled|canceled|dismissed/i.test(spotError(error));
}

export const SPOT_CURATED_ASSETS: SpotAsset[] = [
  spotAsset("XLM", undefined, SPOT_NETWORK_ID), spotAsset("USDC", SPOT_MAINNET_USDC_ISSUER, SPOT_NETWORK_ID), spotAsset("EURC", SPOT_MAINNET_EURC_ISSUER, SPOT_NETWORK_ID),
];
export function mergeSpotAssets(...groups: SpotAsset[][]) {
  const map = new Map<string, SpotAsset>();
  for (const asset of groups.flat()) {
    const previous = map.get(asset.id);
    const known = previous?.curated ? previous : asset.curated ? asset : undefined;
    map.set(asset.id, { ...previous, ...asset, ...(known ? { name: known.name, icon: known.icon, curated: true } : {}) });
  }
  return Array.from(map.values());
}

export class SpotHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function spotRead<T>(path: string, signal?: AbortSignal, network: SpotNetworkId = "testnet"): Promise<T> {
  const response = await fetch(`${spotNetwork(network).horizonUrl}${path}`, {
    signal: signal ?? AbortSignal.timeout(15_000), cache: "no-store", headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new SpotHttpError(response.status, `Stellar could not answer this request (${response.status}). Try again.`);
  return response.json() as Promise<T>;
}
export async function verifySpotNetwork(network: SpotNetworkId = "testnet") {
  const config = spotNetwork(network);
  const root = await spotRead<{ network_passphrase: string }>("", undefined, network);
  if (root.network_passphrase !== config.passphrase) throw new Error(`The configured Horizon endpoint is not ${config.label}. Submission is blocked.`);
  const explorer = new URL(spotNetwork(network).explorerBaseUrl);
  if (!explorer.pathname.endsWith(network === "testnet" ? "/testnet" : "/public")) throw new Error("Configure an explorer for the selected Stellar network before swapping.");
}
export async function spotLedgerParameters(network: SpotNetworkId = "testnet") {
  const [, data] = await Promise.all([
    verifySpotNetwork(network),
    spotRead<{ _embedded: { records: { base_reserve_in_stroops: number; base_fee_in_stroops: number; closed_at?: string }[] } }>("/ledgers?order=desc&limit=1", undefined, network),
  ]);
  const ledger = data._embedded.records[0];
  if (!ledger || ledger.base_reserve_in_stroops !== 5_000_000) throw new Error("The network reserve changed. Swapping is temporarily unavailable.");
  return { reserve: BigInt(ledger.base_reserve_in_stroops), baseFee: BigInt(ledger.base_fee_in_stroops), closedAt: ledger.closed_at ? Date.parse(ledger.closed_at) : undefined };
}
export function spotTransactionUrl(hash: string, network: SpotNetworkId = "testnet") {
  if (!/^[a-f0-9]{64}$/i.test(hash)) return undefined;
  const explorer = new URL(spotNetwork(network).explorerBaseUrl);
  return explorer.pathname.endsWith(network === "testnet" ? "/testnet" : "/public") ? `${explorer.toString().replace(/\/$/, "")}/tx/${hash}` : undefined;
}

// Bind wallet approval and submission to the inspected transaction body.
export function spotEnvelopeHash(xdr: string, network: SpotNetworkId = "testnet") {
  const tx = TransactionBuilder.fromXDR(xdr, spotNetwork(network).passphrase);
  if (!(tx instanceof Transaction)) throw new Error("An unexpected signed envelope was returned. Submission is blocked.");
  return Array.from(tx.hash(), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function verifySignedSpotEnvelope(xdr: string, expected: { hash: string; expiresAt: number }, now = Date.now(), network: SpotNetworkId = "testnet") {
  if (spotEnvelopeHash(xdr, network) !== expected.hash) throw new Error("The wallet changed the reviewed transaction. Submission is blocked.");
  if (now >= expected.expiresAt) throw new Error("The transaction expired while waiting for wallet approval. Refresh and review it again.");
}
export function inspectSpotEnvelope(xdr: string, quote: SpotQuote, bps: number, account: SpotAccount, reserve: bigint) {
  const network = quote.request.from.network;
  const tx = TransactionBuilder.fromXDR(xdr, spotNetwork(network).passphrase);
  if (!(tx instanceof Transaction) || tx.source !== account.account_id) throw new Error("The swap transaction source changed. Refresh before approving.");
  const paths = tx.operations.filter(operation => operation.type === "pathPaymentStrictSend");
  if (paths.length !== 1 || tx.operations.length > 2 || tx.memo.type !== "none") throw new Error("An unexpected swap transaction was returned. Approval is blocked.");
  const operation = paths[0];
  const { request } = quote;
  const send = operation.sendAsset.isNative() ? spotAsset("XLM", undefined, network) : spotAsset(operation.sendAsset.getCode(), operation.sendAsset.getIssuer(), network);
  const receive = operation.destAsset.isNative() ? spotAsset("XLM", undefined, network) : spotAsset(operation.destAsset.getCode(), operation.destAsset.getIssuer(), network);
  if (send.id !== request.from.id || receive.id !== request.to.id || operation.destination !== account.account_id
    || (operation.source && operation.source !== account.account_id) || parseSpotAmount(operation.sendAmount) !== parseSpotAmount(request.amount)) {
    throw new Error("The swap assets, amount or recipient changed. Approval is blocked.");
  }
  if (parseSpotAmount(operation.destMin) < parseSpotAmount(minimumReceived(quote.output, bps))) {
    throw new Error("The new quote would weaken your reviewed minimum received. Refresh the quote and review it again.");
  }
  if (quote.route) {
    const actual = [request.from, ...operation.path.map(asset => asset.isNative() ? spotAsset("XLM", undefined, network) : spotAsset(asset.getCode(), asset.getIssuer(), network)), request.to];
    if (spotRouteKey({ ...quote, route: actual }) !== spotRouteKey(quote)) throw new Error("The selected Stellar path changed. Refresh quotes before approving.");
  }
  let newEntry = 0;
  for (const op of tx.operations) {
    if (op.type === "pathPaymentStrictSend") continue;
    if (op.type !== "changeTrust" || !("getCode" in op.line) || op.line.getCode() !== request.to.code
      || op.line.getIssuer() !== request.to.issuer || (op.source && op.source !== account.account_id)) {
      throw new Error("The swap contains an unexpected operation. Approval is blocked.");
    }
    if (!balanceLine(account, request.to)) newEntry += 1;
  }
  const requirements = spotRequirements(account, request.from, request.to, reserve, quote.output);
  if (tx.operations.length !== requirements.operations || (requirements.operations === 2 && tx.operations[0].type !== "changeTrust")) {
    throw new Error("The receiving trustline must be established before the swap. Refresh and review the transaction again.");
  }
  const fee = BigInt(tx.fee);
  if (fee !== BLUX_SWAP_FEE_PER_OPERATION * BigInt(tx.operations.length) || fee > requirements.fee) {
    throw new Error("The transaction fee changed. Refresh the quote and review it again.");
  }
  const entries = 2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0) + newEntry;
  const xlmNeeded = BigInt(Math.max(0, entries)) * reserve + fee + (request.from.kind === "native" ? parseSpotAmount(request.amount) : BigInt("0"));
  if (availableAsset(account, spotAsset("XLM")) < xlmNeeded) throw new Error("Insufficient XLM for this transaction’s reserve and fee.");
  if (!tx.timeBounds || !Number(tx.timeBounds.maxTime)) throw new Error("The swap has no expiration. Approval is blocked.");
  return { hash: spotEnvelopeHash(xdr, network), minimum: operation.destMin, fee, expiresAt: Number(tx.timeBounds.maxTime) * 1000 };
}
