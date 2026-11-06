import { getState, getStrictSendPaths, StellarSdk } from "@bluxcc/react";
import type { SpotCandidate } from "./spot-api";
import { spotNetwork } from "./spot-network";
import { inspectSorobanSpotEnvelope, sorobanSpotValidation } from "./spot-soroban";
import { readSpotContractBalance } from "./spot-contract-token";
import {
  balanceLine, baseAccount, bluxAsset, BLUX_SWAP_FEE_PER_OPERATION, inspectSpotEnvelope, minimumReceived,
  parseSpotAmount, selectSpotPath, spotLedgerParameters, spotRead, spotValidation,
  SpotHttpError, spotContractId, spotEnvelopeHash, trustlineChange, verifySignedSpotEnvelope, verifySpotNetwork, type SpotAccount, type SpotAsset, type SpotPathRecord,
} from "./spot-utils";

export type SpotSwapReview = { quote: SpotCandidate; bps: number; fee: bigint; trustline?: { reserve: bigint; fee: bigint } };
type SigningAccount = SpotAccount & { sequence: string; signers?: { key: string; type: string; weight: number }[] };
type SpotSigner = (xdr: string, options: { network: string }) => Promise<unknown>;
type SpotSubmission = { hash: string; expiresAt: number };
export type SpotExecutionResult = { hash: string; raw: unknown; returnValue: () => Promise<{ amount_out?: bigint }> };
export type SpotExecutionProgress = "trustline-wallet" | "trustline-pending" | "swap";
type SpotExecutionOptions = {
  onProgress?: (stage: SpotExecutionProgress) => void;
  onTrustlineConfirmed?: (account: SpotAccount) => Promise<unknown>;
};

// Blux exposes the wallet's session network. The signing request also pins the
// network, and the returned signature is checked against that network below.
export function spotWalletNetwork() {
  const state = getState();
  if (!state.authState.isAuthenticated || !state.user) throw new Error("Wallet is disconnected.");
  return state.user.authMethod === "wallet" ? state.user.walletPassphrase : state.stellar?.activeNetwork;
}
function assertWallet(account: string, passphrase: string) {
  const state = getState();
  if (!state.authState.isAuthenticated || !state.user || baseAccount(state.user.address) !== account) throw new Error("The connected account changed. Review this swap again.");
  if (state.stellar?.activeNetwork !== passphrase || spotWalletNetwork() !== passphrase) throw new Error("Switch the wallet to Stellar Mainnet before approving this swap.");
}
function sdkAsset(asset: SpotAsset) {
  if (asset.kind === "contract") throw new Error("Contract tokens require a Soroban route.");
  return asset.kind === "native" ? StellarSdk.Asset.native() : new StellarSdk.Asset(asset.code, asset.issuer!);
}
export function buildNativeSpotEnvelope(review: SpotSwapReview, account: SigningAccount, paths: SpotPathRecord[]) {
  const { quote, bps } = review;
  if (quote.request.from.kind === "contract" || quote.request.to.kind === "contract") throw new Error("Contract tokens require a Soroban route.");
  const path = selectSpotPath(paths, quote);
  if (parseSpotAmount(path.destination_amount) < parseSpotAmount(quote.output)) throw new Error("The quote changed. Refresh and review the swap again.");
  const { from, to, amount } = quote.request;
  const builder = new StellarSdk.TransactionBuilder(new StellarSdk.Account(account.account_id, account.sequence), {
    networkPassphrase: spotNetwork(from.network).passphrase, fee: BLUX_SWAP_FEE_PER_OPERATION.toString(),
  });
  if (trustlineChange(account, to, path.destination_amount).operations === 2) builder.addOperation(StellarSdk.Operation.changeTrust({ asset: sdkAsset(to) }));
  builder.addOperation(StellarSdk.Operation.pathPaymentStrictSend({
    sendAsset: sdkAsset(from), sendAmount: amount, destination: account.account_id,
    destAsset: sdkAsset(to), destMin: minimumReceived(quote.output, bps),
    path: path.path.map(asset => asset.asset_type === "native" ? StellarSdk.Asset.native() : new StellarSdk.Asset(asset.asset_code!, asset.asset_issuer!)),
  }));
  return builder.setTimeout(180).build().toXDR();
}
export function verifySpotSignature(signedXdr: string, account: SigningAccount, network: string) {
  const transaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, network);
  const keys = [account.account_id, ...(account.signers ?? []).filter(signer => signer.type === "ed25519_public_key" && signer.weight > 0).map(signer => signer.key)];
  if (!transaction.signatures.some(signature => keys.some(key => StellarSdk.Keypair.fromPublicKey(key).verify(transaction.hash(), signature.signature)))) {
    throw new Error("The wallet returned no valid signature for this account and network. Submission is blocked.");
  }
}

export function buildSpotTrustlineEnvelope(account: SigningAccount, asset: SpotAsset) {
  if (asset.kind !== "classic" || balanceLine(account, asset)) throw new Error("A new classic receiving trustline is required.");
  return new StellarSdk.TransactionBuilder(new StellarSdk.Account(account.account_id, account.sequence), {
    networkPassphrase: spotNetwork(asset.network).passphrase, fee: BLUX_SWAP_FEE_PER_OPERATION.toString(),
  }).addOperation(StellarSdk.Operation.changeTrust({ asset: sdkAsset(asset) })).setTimeout(180).build();
}
async function addSpotTrustline(review: SpotSwapReview, signTransaction: SpotSigner, options: SpotExecutionOptions) {
  const { quote } = review, { from, to, account: address } = quote.request;
  if (to.kind !== "classic") return;
  const account = await spotRead<SigningAccount>(`/accounts/${address}`, undefined, from.network);
  if (balanceLine(account, to)) return;
  const parameters = await spotLedgerParameters(from.network);
  if (!review.trustline || review.trustline.fee < BLUX_SWAP_FEE_PER_OPERATION || review.trustline.reserve < parameters.reserve) throw new Error("The receiving trustline changed. Review this swap again.");
  const [metadata, contractBalance] = await Promise.all([
    spotRead<{ _embedded: { records: { flags: { auth_required: boolean } }[] } }>(`/assets?asset_code=${encodeURIComponent(to.code)}&asset_issuer=${to.issuer}&limit=1`, undefined, from.network),
    from.kind === "contract" ? readSpotContractBalance(from, address!) : undefined,
  ]);
  const flags = metadata._embedded.records[0]?.flags;
  if (typeof flags?.auth_required !== "boolean") throw new Error("Asset permissions could not be checked. Refresh and try again.");
  if (contractBalance !== undefined) account.contractBalances = { [spotContractId(from)]: contractBalance };
  const error = sorobanSpotValidation(account, { ...quote, request: { ...quote.request, to: { ...to, authRequired: flags.auth_required } } }, parameters.reserve);
  if (error) throw new Error(error);
  const network = spotNetwork(from.network);
  const transaction = buildSpotTrustlineEnvelope(account, to);
  const checked = { hash: spotEnvelopeHash(transaction.toXDR(), from.network), expiresAt: Number(transaction.timeBounds!.maxTime) * 1000 };
  assertSpotQuoteLive(quote);
  assertWallet(address!, network.passphrase);
  options.onProgress?.("trustline-wallet");
  const signedXdr = await signTransaction(transaction.toXDR(), { network: network.passphrase });
  if (typeof signedXdr !== "string" || !signedXdr) throw new Error("The wallet request was rejected or returned no signed transaction.");
  await Promise.all([assertWallet(address!, network.passphrase), verifySpotNetwork(from.network)]);
  verifySignedSpotEnvelope(signedXdr, checked, Date.now(), from.network);
  verifySpotSignature(signedXdr, account, network.passphrase);
  options.onProgress?.("trustline-pending");
  // This hash is deliberately never passed to swap recovery or attribution.
  let confirmed = false;
  try {
    const raw = await new StellarSdk.Horizon.Server(network.horizonUrl).submitTransaction(StellarSdk.TransactionBuilder.fromXDR(signedXdr, network.passphrase));
    if (raw.hash !== checked.hash || raw.successful !== true || !Number.isInteger(raw.ledger)) throw new Error("Stellar returned an invalid trustline confirmation.");
    confirmed = true;
  } catch (error) {
    if ((error as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes) throw error;
    // Horizon may accept the transaction while its submission response is lost.
    // Only an included, successful transaction allows the swap to continue.
    for (let attempt = 0; attempt < 15; attempt++) {
      let tx: { hash: string; successful: boolean; ledger: number } | undefined;
      try {
        tx = await spotRead<typeof tx>(`/transactions/${checked.hash}`, undefined, from.network);
      } catch (confirmationError) {
        if (!(confirmationError instanceof SpotHttpError && confirmationError.status === 404)) throw new Error("Trustline confirmation is unavailable. No swap was submitted. Refresh your balances before retrying.", { cause: confirmationError });
      }
      if (tx) {
        if (tx.hash !== checked.hash || !Number.isInteger(tx.ledger) || typeof tx.successful !== "boolean") throw new Error("Stellar returned an invalid trustline confirmation. No swap was submitted.");
        if (!tx.successful) throw new Error("The trustline transaction failed. No swap was submitted.");
        confirmed = true;
        break;
      }
      if (Date.now() >= checked.expiresAt) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!confirmed) throw new Error("Trustline confirmation is unavailable. No swap was submitted. Refresh your balances before retrying.");
  const refreshed = await spotRead<SigningAccount>(`/accounts/${address}`, undefined, from.network);
  await options.onTrustlineConfirmed?.(refreshed);
  if (!balanceLine(refreshed, to)) throw new Error("The confirmed trustline is not available yet. Refresh your balances before retrying.");
  if (balanceLine(refreshed, to)?.is_authorized === false) throw new Error("This asset requires issuer authorization before it can be swapped.");
  return refreshed;
}
function assertSpotQuoteLive(quote: SpotCandidate) {
  if (quote.soroban && Date.parse(quote.soroban.expiresAt) <= Date.now() + 5000) throw new Error("This quote expired. Refresh and review the swap again.");
}

// Build and inspect locally, sign through Blux React's public API, then verify
// the signed body before broadcasting. No SDK files or private APIs are patched.
export async function executeSpotSwap(review: SpotSwapReview, signTransaction: SpotSigner, onSigned: (submission: SpotSubmission) => void, onSubmitted?: (hash: string) => void, options: SpotExecutionOptions = {}): Promise<SpotExecutionResult> {
  const { quote } = review;
  const address = quote.request.account;
  if (!address) throw new Error("Connect your wallet before swapping.");
  const network = spotNetwork(quote.request.from.network);
  await Promise.all([assertWallet(address, network.passphrase), verifySpotNetwork(quote.request.from.network)]);
  let xdr: string;
  const rpc = new StellarSdk.rpc.Server(network.sorobanRpcUrl);
  if (quote.source === "soroban" && quote.soroban) {
    assertSpotQuoteLive(quote);
    const refreshed = await addSpotTrustline(review, signTransaction, options);
    assertSpotQuoteLive(quote);
    assertWallet(address, network.passphrase);
    options.onProgress?.("swap");
    const call = quote.soroban.txData;
    const [source, client] = await Promise.all([
      refreshed ? new StellarSdk.Account(address, refreshed.sequence) : rpc.getAccount(address),
      StellarSdk.contract.Client.from({ contractId: call.address, networkPassphrase: network.passphrase, rpcUrl: network.sorobanRpcUrl, server: rpc }),
    ]);
    const inputs = client.spec.getFunc(call.fn).inputs;
    const args = client.spec.funcArgsToScVals(call.fn, Object.fromEntries(inputs.map((input, index) => [input.name.toString(), call.args[index]])));
    const transaction = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase: network.passphrase })
      .addOperation(new StellarSdk.Contract(call.address).call(call.fn, ...args)).setTimeout(180).build();
    const simulation = await rpc.simulateTransaction(transaction);
    if (StellarSdk.rpc.Api.isSimulationError(simulation)) throw new Error(`Contract simulation failed: ${simulation.error}`);
    xdr = StellarSdk.rpc.assembleTransaction(transaction, simulation).build().toXDR();
  } else {
    const [account, paths] = await Promise.all([
      spotRead<SigningAccount>(`/accounts/${address}`, undefined, quote.request.from.network),
      getStrictSendPaths([bluxAsset(quote.request.from), quote.request.amount, [bluxAsset(quote.request.to)]], { network: network.passphrase }),
    ]);
    xdr = buildNativeSpotEnvelope(review, account, paths.response.records as SpotPathRecord[]);
  }
  const [account, parameters, contractBalance] = await Promise.all([
    spotRead<SigningAccount>(`/accounts/${address}`, undefined, quote.request.from.network), spotLedgerParameters(quote.request.from.network),
    quote.request.from.kind === "contract" ? readSpotContractBalance(quote.request.from, address) : undefined,
  ]);
  if (contractBalance !== undefined) account.contractBalances = { [spotContractId(quote.request.from)]: contractBalance };
  if (quote.source === "soroban" && quote.request.to.kind === "classic" && !balanceLine(account, quote.request.to)) throw new Error("The receiving trustline changed. Refresh and review this swap again.");
  const error = quote.source === "soroban" ? sorobanSpotValidation(account, quote, parameters.reserve)
    : spotValidation(account, quote.request, parameters.reserve, quote.output);
  if (error) throw new Error(error);
  const checked = quote.source === "soroban" ? inspectSorobanSpotEnvelope(xdr, quote)
    : inspectSpotEnvelope(xdr, quote, review.bps, account, parameters.reserve);
  if ("fee" in checked && typeof checked.fee === "bigint" && checked.fee > review.fee) throw new Error("The network fee changed. Review the swap again.");
  await assertWallet(address, network.passphrase);
  const signedXdr = await signTransaction(xdr, { network: network.passphrase });
  if (typeof signedXdr !== "string" || !signedXdr) throw new Error("The wallet request was rejected or returned no signed transaction.");
  await Promise.all([assertWallet(address, network.passphrase), verifySpotNetwork(quote.request.from.network)]);
  verifySignedSpotEnvelope(signedXdr, checked, Date.now(), quote.request.from.network);
  verifySpotSignature(signedXdr, account, network.passphrase);
  onSigned(checked);
  const signed = StellarSdk.TransactionBuilder.fromXDR(signedXdr, network.passphrase);
  if (quote.source === "native") {
    const raw = await new StellarSdk.Horizon.Server(network.horizonUrl).submitTransaction(signed);
    if (raw.hash !== checked.hash) throw new Error("The submitted transaction does not match the reviewed swap.");
    if (raw.successful === true) onSubmitted?.(raw.hash);
    return { hash: raw.hash, raw, returnValue: async () => ({}) };
  }
  const submitted = await rpc.sendTransaction(signed);
  if (submitted.hash !== checked.hash) throw new Error("The submitted transaction does not match the reviewed aggregator call.");
  if (submitted.status === "ERROR") throw new Error("Stellar rejected the aggregator transaction. Check status before retrying.");
  if (submitted.status === "PENDING" || submitted.status === "DUPLICATE") onSubmitted?.(submitted.hash);
  const result = await rpc.pollTransaction(submitted.hash, { attempts: 30 });
  if (result.status !== "SUCCESS") throw new Error("Stellar has not returned a successful confirmation yet. Check status.");
  return { hash: submitted.hash, raw: result, returnValue: async () => result.returnValue ? StellarSdk.scValToNative(result.returnValue) as { amount_out?: bigint } : {} };
}
