import { getState, getStrictSendPaths, StellarSdk } from "@bluxcc/react";
import type { SpotCandidate } from "./spot-api";
import { spotNetwork } from "./spot-network";
import { inspectSorobanSpotEnvelope, sorobanSpotValidation } from "./spot-soroban";
import {
  baseAccount, bluxAsset, BLUX_SWAP_FEE_PER_OPERATION, inspectSpotEnvelope, minimumReceived,
  parseSpotAmount, selectSpotPath, spotLedgerParameters, spotRead, spotValidation,
  trustlineChange, verifySignedSpotEnvelope, verifySpotNetwork, type SpotAccount, type SpotAsset, type SpotPathRecord,
} from "./spot-utils";

export type SpotSwapReview = { quote: SpotCandidate; bps: number; fee: bigint };
type SigningAccount = SpotAccount & { sequence: string; signers?: { key: string; type: string; weight: number }[] };
type SpotSigner = (xdr: string, options: { network: string }) => Promise<unknown>;
type SpotSubmission = { hash: string; expiresAt: number };
export type SpotExecutionResult = { hash: string; raw: unknown; returnValue: () => Promise<{ amount_out?: bigint }> };

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
  return asset.kind === "native" ? StellarSdk.Asset.native() : new StellarSdk.Asset(asset.code, asset.issuer!);
}
export function buildNativeSpotEnvelope(review: SpotSwapReview, account: SigningAccount, paths: SpotPathRecord[]) {
  const { quote, bps } = review;
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

// Build and inspect locally, sign through Blux React's public API, then verify
// the signed body before broadcasting. No SDK files or private APIs are patched.
export async function executeSpotSwap(review: SpotSwapReview, signTransaction: SpotSigner, onSigned: (submission: SpotSubmission) => void, onSubmitted?: (hash: string) => void): Promise<SpotExecutionResult> {
  const { quote } = review;
  const address = quote.request.account;
  if (!address) throw new Error("Connect your wallet before swapping.");
  const network = spotNetwork(quote.request.from.network);
  await Promise.all([assertWallet(address, network.passphrase), verifySpotNetwork(quote.request.from.network)]);
  let xdr: string;
  const rpc = new StellarSdk.rpc.Server(network.sorobanRpcUrl);
  if (quote.source === "soroban" && quote.soroban) {
    const call = quote.soroban.txData;
    const [source, client] = await Promise.all([
      rpc.getAccount(address),
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
  const [account, parameters] = await Promise.all([
    spotRead<SigningAccount>(`/accounts/${address}`, undefined, quote.request.from.network), spotLedgerParameters(quote.request.from.network),
  ]);
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
