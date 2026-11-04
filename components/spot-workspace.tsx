"use client";

import { Asset, useAssets, useBlux, useNetwork, useStrictSendPaths, switchNetwork } from "@bluxcc/react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SPOT_NETWORK, SPOT_NETWORK_ID } from "./spot-network";
import { LUMIX_STELLAR_NETWORK } from "./stellar-network";
import { fetchSpotApiEnabled, fetchSpotApiQuotes, spotApiRefreshMs, spotCandidateMinimum, spotCandidates, spotQuoteProtocols } from "./spot-api";
import { SpotAccordion, SpotQuoteOptions, SpotRouteDetails } from "./spot-quote-options";
import { sorobanSpotValidation, SOROBAN_SPOT_FEE_CAP } from "./spot-soroban";
import { executeSpotSwap, spotWalletNetwork, type SpotSwapReview } from "./spot-execution";
import { recordSpotSwap, spotSwapRecordPayload, type RecordSwapPayload } from "./spot-swap-record";
import { Icon } from "./icon";
import { SpotAssetSelector, spotIssuerLabel } from "./spot-asset-selector";
import { SpotTokenIcon } from "./spot-token-icon";
import { SpotValueSkeleton } from "./spot-loading";
import { useAccessibleOverlay } from "./use-accessible-overlay";
import { useHydrated } from "./use-hydrated";
import { useWallet } from "./wallet-provider";
import {
  SPOT_CURATED_ASSETS, SPOT_QUOTE_REFRESH_MS, BLUX_SWAP_FEE_PER_OPERATION,
  availableAsset, baseAccount, formatSpotAmount, formatSpotQuoteAmount, formatSpotFee,
  mergeSpotAssets, parseSlippage, parseSpotAmount, quotesFromPaths,
  SpotHttpError, spotAsset, spotDecimal, spotError, spotLedgerParameters, spotRate, spotRead,
  spotRequestKey, spotRequirements, spotTransactionUrl, spotValidation,
  walletRejected, type SpotAccount, type SpotAsset,
  type SpotQuote, type SpotReceipt, type SpotRequest,
} from "./spot-utils";

const swapKey = ["lumix", "spot", "swap"];
// Retain the submitted identity and attribution for confirmation recovery after
// navigation or a lost HTTP response. Mutation progress belongs to React Query.
const pendingKey = ["lumix", "spot", "submitted"];
type PendingSwap = { hash: string; account: string; expiresAt: number; asset: SpotAsset; source?: "native" | "soroban"; attribution?: RecordSwapPayload; reported?: boolean };
const transactionKey = (hash?: string) => ["lumix", "spot", "transaction", hash];

type TransactionRecord = { hash: string; successful: boolean; fee_charged: string; ledger: number; received?: string };
async function readTransaction(hash: string): Promise<TransactionRecord | null> {
  try {
    const tx = await spotRead<TransactionRecord>(`/transactions/${hash}`, undefined, SPOT_NETWORK_ID);
    if (tx.hash !== hash || typeof tx.successful !== "boolean" || !Number.isInteger(tx.ledger) || !/^\d+$/.test(tx.fee_charged)) throw new Error("Stellar returned an invalid transaction confirmation.");
    return tx;
  } catch (error) {
    if (error instanceof SpotHttpError && error.status === 404) return null;
    throw error;
  }
}
const native = Asset.native();
function sdkAsset(asset?: SpotAsset) { return !asset || asset.kind === "native" ? native : new Asset(asset.code, asset.issuer!); }

export function SpotWorkspace() {
  // Switch before paint so the ticket never renders against the app-wide
  // network, and restore that network for the other products on exit.
  useLayoutEffect(() => {
    switchNetwork(SPOT_NETWORK.passphrase);
    return () => { switchNetwork(LUMIX_STELLAR_NETWORK.passphrase); };
  }, []);
  return <SpotTrading />;
}

function SpotTrading() {
  const wallet = useWallet();
  const blux = useBlux();
  const network = useNetwork();
  const hydrated = useHydrated();
  const [pay, setPay] = useState(SPOT_CURATED_ASSETS[0]);
  const [receive, setReceive] = useState(SPOT_CURATED_ASSETS[1]);
  const [imported, setImported] = useState<SpotAsset[]>([]);
  const [amount, setAmount] = useState(""); const [slippageInput, setSlippageInput] = useState("0.3");
  const bps = parseSlippage(slippageInput);
  const [slippageOpen, setSlippageOpen] = useState(false); const [feesExpanded, setFeesExpanded] = useState(false);
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [dialog, setDialog] = useState<"closed" | "review" | "execution">("closed");
  const [review, setReview] = useState<SpotSwapReview | null>(null);
  const [inputError, setInputError] = useState("");
  const dialogRef = useRef<HTMLElement>(null); const titleRef = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const busy = useIsMutating({ mutationKey: swapKey }) > 0;
  const submittedQuery = useQuery<PendingSwap | null>({ queryKey: pendingKey, queryFn: async () => null, initialData: null, enabled: false, gcTime: Infinity });
  const submitted = submittedQuery.data?.asset.network === SPOT_NETWORK_ID ? submittedQuery.data : null;
  const transaction = useQuery({
    queryKey: transactionKey(submitted?.hash), queryFn: () => readTransaction(submitted!.hash),
    enabled: Boolean(submitted) && !busy, retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false,
  });
  const uncertain = Boolean(submitted && !busy && !transaction.data);
  const activity = useQuery({
    queryKey: ["lumix", "spot", "swap-activity", submitted?.hash],
    queryFn: () => spotRead<{ _embedded: { records: { type: string; amount?: string }[] } }>(`/transactions/${submitted!.hash}/operations`, undefined, SPOT_NETWORK_ID),
    enabled: transaction.data?.successful === true, retry: false, staleTime: Infinity,
  });
  const receipt: SpotReceipt | undefined = transaction.data?.successful ? {
    hash: transaction.data.hash, fee: spotDecimal(BigInt(transaction.data.fee_charged)), ledger: transaction.data.ledger,
    received: transaction.data.received ?? activity.data?._embedded.records.find(op => op.type === "path_payment_strict_send")?.amount ?? "",
  } : undefined;
  const connected = blux.isReady && blux.isAuthenticated && Boolean(blux.user?.address);
  let address: string | undefined;
  try { address = connected ? baseAccount(blux.user!.address) : undefined; } catch { /* Invalid wallets cannot query or submit. */ }
  let units = BigInt("0"); let amountError = "";
  try { if (amount && amount !== ".") units = parseSpotAmount(amount); } catch (error) { amountError = spotError(error); }
  const currentRequest = useMemo<SpotRequest | null>(() => units > BigInt("0") && !amountError && !inputError && pay.id !== receive.id ? {
    from: pay, to: receive, amount: spotDecimal(units), account: address,
  } : null, [pay, receive, units, amountError, inputError, address]);
  const [debouncedAmount, setDebouncedAmount] = useState(amount);
  useEffect(() => {
    if (amount === debouncedAmount) return;
    const timer = window.setTimeout(() => setDebouncedAmount(amount), 350);
    return () => window.clearTimeout(timer);
  }, [amount, debouncedAmount]);
  // Only typing is debounced; the initial pair and asset changes can load now.
  const request = amount === debouncedAmount ? currentRequest : null;
  const walletNetworkQuery = useQuery({
    queryKey: ["lumix", "spot", "wallet-network", address, blux.user?.authValue, blux.user?.walletPassphrase], queryFn: spotWalletNetwork,
    enabled: connected, staleTime: 0, retry: false, refetchInterval: connected ? 3000 : false,
    refetchOnWindowFocus: "always", refetchOnReconnect: "always",
  });
  const walletOnNetwork = !connected || (walletNetworkQuery.isSuccess && walletNetworkQuery.data === SPOT_NETWORK.passphrase && !walletNetworkQuery.isError);
  const networkQuery = useQuery({
    queryKey: ["lumix", "spot", "parameters", SPOT_NETWORK_ID], queryFn: () => spotLedgerParameters(SPOT_NETWORK_ID),
    enabled: blux.isReady, staleTime: 30_000, refetchInterval: 30_000, retry: 1,
  });
  const validNetwork = blux.isReady && network === SPOT_NETWORK.passphrase && walletOnNetwork && networkQuery.isSuccess && !networkQuery.isError;
  const canReadNetwork = blux.isReady && network === SPOT_NETWORK.passphrase;
  // Preserve 404 versus transport failure and read the account's reserves.
  const accountQuery = useQuery({
    queryKey: ["lumix", "spot", "account", SPOT_NETWORK.passphrase, address],
    queryFn: async () => {
      try { return await spotRead<SpotAccount>(`/accounts/${address}`, undefined, SPOT_NETWORK_ID); }
      catch (error) { if (error instanceof SpotHttpError && error.status === 404) return null; throw error; }
    },
    enabled: canReadNetwork && Boolean(address), staleTime: 10_000, retry: 1,
    refetchOnWindowFocus: "always", refetchOnReconnect: "always", refetchInterval: address ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
  // This same account response already contains every balance, including zero
  // trustlines. Avoid a second identical Horizon read through useBalances.
  const nativeBalanceReturned = Boolean(accountQuery.data?.balances.some(line => line.asset_type === "native"));
  const account = useMemo<SpotAccount | undefined>(() => accountQuery.data && nativeBalanceReturned
    ? accountQuery.data : undefined, [accountQuery.data, nativeBalanceReturned]);
  const held = useMemo(() => account?.balances.flatMap(line => {
    try {
      if (line.asset_type === "native") return [spotAsset("XLM", undefined, SPOT_NETWORK_ID)];
      return line.asset_type === "credit_alphanum4" || line.asset_type === "credit_alphanum12" ? [spotAsset(line.asset_code!, line.asset_issuer, SPOT_NETWORK_ID)] : [];
    } catch { return []; }
  }) ?? [], [account]);
  const from = useMemo(() => sdkAsset(request?.from), [request?.from]);
  const to = useMemo(() => sdkAsset(request?.to), [request?.to]);
  const candidates = useMemo(() => [to], [to]);
  let validRequest = false;
  try { validRequest = Boolean(request && parseSpotAmount(request.amount) > BigInt("0") && request.from.id !== request.to.id); } catch { /* UI reports precision errors. */ }
  const paths = useStrictSendPaths([from, request?.amount ?? "1", candidates], { network: SPOT_NETWORK.passphrase }, {
    enabled: canReadNetwork && validRequest && !busy && !uncertain, retry: false, staleTime: SPOT_QUOTE_REFRESH_MS,
    refetchInterval: SPOT_QUOTE_REFRESH_MS, refetchIntervalInBackground: false,
    refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const metadata = useAssets({ forCode: request?.to.code, forIssuer: request?.to.issuer, network: SPOT_NETWORK.passphrase, limit: 1 }, {
    enabled: canReadNetwork && request?.to.kind === "classic", retry: 1, staleTime: 30_000,
  });
  const refetchPaths = paths.refetch;
  const previousAccount = useRef(address);
  useEffect(() => {
    // Blux's public path key includes the pair/amount/network, but not account.
    // Other key changes already fetch automatically through React Query.
    if (previousAccount.current === address) return;
    previousAccount.current = address;
    if (canReadNetwork && validRequest && !busy && !uncertain) void refetchPaths({ cancelRefetch: false });
  }, [address, canReadNetwork, validRequest, busy, uncertain, refetchPaths]);
  const quoteResult = useMemo<{ quotes?: SpotQuote[]; error?: unknown }>(() => {
    if (uncertain || !validNetwork || !validRequest || !request || !paths.data || paths.isError
      || !currentRequest || spotRequestKey(currentRequest) !== spotRequestKey(request)) return {};
    const enriched = { ...request, to: { ...request.to, authRequired: metadata.data?.response.records[0]?.flags.auth_required } };
    try { return { quotes: quotesFromPaths(paths.data.response.records, enriched) }; }
    catch (error) { return { error }; }
  }, [uncertain, currentRequest, validNetwork, validRequest, request, paths.data, paths.isError, metadata.data]);
  const apiConfig = useQuery({
    queryKey: ["lumix", "spot", "api-config"], queryFn: ({ signal }) => fetchSpotApiEnabled(signal),
    retry: false, staleTime: SPOT_QUOTE_REFRESH_MS,
  });
  const apiEnabled = apiConfig.data === true && !apiConfig.isError;
  const apiQuotes = useQuery({
    queryKey: ["lumix", "spot", "soroban-quotes", request ? spotRequestKey(request) : null, bps],
    queryFn: ({ signal }) => fetchSpotApiQuotes(request!, bps!, SPOT_NETWORK.passphrase, signal),
    enabled: apiEnabled && validNetwork && validRequest && (!connected || Boolean(address)) && Boolean(bps) && !busy && !uncertain,
    retry: false, staleTime: SPOT_QUOTE_REFRESH_MS,
    refetchInterval: query => query.state.status === "error" ? SPOT_QUOTE_REFRESH_MS : spotApiRefreshMs(query.state.data),
    refetchIntervalInBackground: false, refetchOnWindowFocus: true,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!apiEnabled || !apiQuotes.data?.data.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [apiEnabled, apiQuotes.data]);
  const [selection, setSelection] = useState<{ key: string; id: string }>();
  const selectionKey = `${currentRequest ? spotRequestKey(currentRequest) : ""}|${bps}|${apiEnabled}`;
  const quotes = currentRequest && validNetwork && request && spotRequestKey(request) === spotRequestKey(currentRequest)
    ? spotCandidates(quoteResult.quotes, apiEnabled && !apiQuotes.isError ? apiQuotes.data : undefined, currentRequest, bps ?? 30, now) : [];
  const quote = selection?.key === selectionKey ? quotes.find(item => item.id === selection.id) : quotes[0];
  // Spot moves Blux to Mainnet itself, so a different app network is a switch
  // in progress. A different wallet session network is "wrong".
  const networkSettled = hydrated && blux.isReady && network === SPOT_NETWORK.passphrase;
  const networkStatus = !networkSettled || (connected && walletNetworkQuery.isPending) ? "checking"
    : walletNetworkQuery.isSuccess && !walletOnNetwork ? "wrong"
    : networkQuery.isError || walletNetworkQuery.isError ? "error" : networkQuery.isSuccess ? "ready" : "checking";
  const networkError = spotError(walletNetworkQuery.error ?? networkQuery.error);
  const accountStatus = !connected ? "disconnected" : !address ? "error" : accountQuery.isError
    || (accountQuery.data && !nativeBalanceReturned) ? "error"
    : accountQuery.data === null ? "unfunded" : !account ? "loading" : "ready";
  const accountError = accountQuery.error ? spotError(accountQuery.error) : `Refresh your ${SPOT_NETWORK.name} balance and try again.`;
  const quoteStatus = !validNetwork || !currentRequest ? "idle" : quote ? "ready"
    : !request || !paths.data && paths.isFetching || apiEnabled && apiQuotes.isFetching ? "loading"
    : quotes.length ? "choose" : paths.isError || quoteResult.error ? "error" : "no-route";
  const quoteError = paths.error || quoteResult.error ? spotError(paths.error ?? quoteResult.error) : "The native quote request failed. Change the amount or try again shortly.";
  const quoteLoading = Boolean(currentRequest && !quote && (networkStatus === "checking" || (networkStatus === "ready" && ["idle", "loading"].includes(quoteStatus))));
  const quoteUpdating = Boolean(quote && (apiConfig.isPending || apiEnabled && apiQuotes.isFetching
    || (quote.source === "native" ? paths.isFetching || paths.isStale : apiQuotes.isStale)));
  const assets = useMemo(() => mergeSpotAssets(SPOT_CURATED_ASSETS, held, imported), [held, imported]);
  const refetchAccount = accountQuery.refetch;
  const refreshSharedBalances = wallet.refreshBalances;
  const refetchNetwork = networkQuery.refetch;
  const refetchWalletNetwork = walletNetworkQuery.refetch;
  const refetchApiQuotes = apiQuotes.refetch;
  const refresh = async () => {
    // Balances must refresh even if the quote or wallet-network check fails.
    const balances = address ? Promise.allSettled([refetchAccount(), refreshSharedBalances()]) : Promise.resolve([]);
    const [parameters, currentNetwork] = await Promise.all([refetchNetwork(), address ? refetchWalletNetwork() : undefined]);
    await balances;
    if (!parameters.isSuccess || network !== SPOT_NETWORK.passphrase || (currentNetwork && (!currentNetwork.isSuccess || currentNetwork.data !== SPOT_NETWORK.passphrase))) return;
    await Promise.allSettled([
      ...(validRequest ? [refetchPaths({ cancelRefetch: false })] : []),
      ...(apiEnabled && validRequest && bps ? [refetchApiQuotes({ cancelRefetch: false })] : []),
    ]);
  };
  const reportSubmittedSwap = useCallback((hash: string) => {
    const intent = queryClient.getQueryData<PendingSwap>(pendingKey);
    if (!intent?.attribution || intent.hash !== hash || intent.reported) return;
    queryClient.setQueryData<PendingSwap>(pendingKey, { ...intent, reported: true });
    void recordSpotSwap(intent.attribution);
  }, [queryClient]);
  useEffect(() => {
    // A lost submission response can still be confirmed by Horizon later.
    if (submitted && transaction.data?.successful && transaction.data.hash === submitted.hash) reportSubmittedSwap(submitted.hash);
  }, [reportSubmittedSwap, submitted, transaction.data]);
  const runSwap = (review: SpotSwapReview) => executeSpotSwap(review, blux.signTransaction, checked => {
    queryClient.setQueryData<PendingSwap>(pendingKey, { ...checked, account: review.quote.request.account!, asset: review.quote.request.to, source: review.quote.source,
      attribution: spotSwapRecordPayload(checked.hash, review.quote) });
  }, reportSubmittedSwap);
  const swapMutation = useMutation({
    mutationFn: runSwap,
    mutationKey: swapKey, retry: false,
    onMutate: () => { queryClient.setQueryData(pendingKey, null); },
    onSuccess: async result => {
      const intent = queryClient.getQueryData<PendingSwap>(pendingKey);
      if (!intent || result.hash !== intent.hash) throw new Error("The submitted transaction did not match the reviewed swap.");
      const raw = result.raw as Partial<TransactionRecord>;
      const tx = raw.hash === result.hash && raw.successful === true && Number.isInteger(raw.ledger) && /^\d+$/.test(raw.fee_charged ?? "")
        ? raw as TransactionRecord : await readTransaction(result.hash);
      if (!tx?.successful) throw new Error("Stellar has not returned a successful confirmation yet.");
      queryClient.setQueryData(transactionKey(result.hash), tx);
      await refresh();
    },
    onError: async error => {
      const intent = queryClient.getQueryData<PendingSwap>(pendingKey);
      const codes = (error as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes;
      if (!intent || codes || walletRejected(error)) { queryClient.setQueryData(pendingKey, null); return; }
      // A lost submit response is not a failed or successful swap. Keep its
      // checked hash until Horizon confirms it, or the ledger proves expiry.
      try {
        const tx = await queryClient.fetchQuery({ queryKey: transactionKey(intent.hash), queryFn: () => readTransaction(intent.hash), staleTime: 0 });
        if (tx?.successful) await refresh();
      } catch { /* The confirmation query and Check status remain available. */ }
    },
  });
  const contractMutation = useMutation({
    mutationFn: runSwap,
    mutationKey: swapKey, retry: false,
    onMutate: () => { queryClient.setQueryData(pendingKey, null); },
    onSuccess: async result => {
      const intent = queryClient.getQueryData<PendingSwap>(pendingKey);
      if (!intent || intent.hash !== result.hash) throw new Error("The submitted transaction does not match the reviewed aggregator call.");
      const tx = await readTransaction(result.hash);
      if (!tx?.successful) throw new Error("Stellar has not returned a successful confirmation yet. Check status.");
      let received: string | undefined;
      try { const value = await result.returnValue(); if (value?.amount_out !== undefined) received = spotDecimal(BigInt(value.amount_out)); } catch { /* Confirmation remains authoritative if decoding is unavailable. */ }
      queryClient.setQueryData(transactionKey(result.hash), { ...tx, received });
      await refresh();
    },
    onError: async error => {
      const intent = queryClient.getQueryData<PendingSwap>(pendingKey);
      if (!intent || walletRejected(error)) { queryClient.setQueryData(pendingKey, null); return; }
      try {
        const tx = await queryClient.fetchQuery({ queryKey: transactionKey(intent.hash), queryFn: () => readTransaction(intent.hash), staleTime: 0 });
        if (tx?.successful) await refresh();
      } catch { /* Preserve the hash until confirmation or proven expiry. */ }
    },
  });
  async function checkPending() {
    if (!submitted || busy) return;
    const [result, parameters] = await Promise.all([transaction.refetch({ cancelRefetch: false }), refetchNetwork()]);
    if (result.data?.successful) await refresh();
    else if (result.isSuccess && result.data === null && parameters.data?.closedAt && parameters.data.closedAt > submitted.expiresAt) {
      queryClient.setQueryData(pendingKey, null);
      swapMutation.reset();
      contractMutation.reset();
    }
  }
  const requirements = account && networkQuery.data !== undefined ? spotRequirements(account, pay, receive, networkQuery.data.reserve, quote?.output) : undefined;
  const validation = account && currentRequest && networkQuery.data !== undefined ? quote?.source === "soroban"
    ? sorobanSpotValidation(account, quote, networkQuery.data.reserve)
    : spotValidation(account, quote?.request ?? currentRequest, networkQuery.data.reserve, quote?.output) : undefined;
  const maxNative = requirements && quote?.source === "soroban" && pay.kind === "native" ? requirements.max + requirements.fee - SOROBAN_SPOT_FEE_CAP : requirements?.max;
  const balance = maxNative !== undefined ? (maxNative > BigInt(0) ? maxNative : BigInt(0)) : account ? availableAsset(account, pay) : undefined;
  const receiveBalance = account ? availableAsset(account, receive) : undefined;
  const minimum = quote && bps ? spotCandidateMinimum(quote, bps) : undefined;
  const executionError = review?.quote.source === "soroban" ? contractMutation.error : swapMutation.error;
  const stage = dialog === "review" ? "review" : busy ? submitted ? "pending" : "wallet"
    : receipt ? "confirmed" : uncertain ? "unconfirmed" : walletRejected(executionError) ? "cancelled" : "failed";
  const message = busy ? submitted ? `Signed. Waiting for ${SPOT_NETWORK.label} confirmation.` : "Review and approve the transaction in your wallet."
    : uncertain ? "Confirmation is unavailable. Check the transaction status before starting another swap."
    : stage === "cancelled" ? "Wallet approval cancelled. No swap was submitted."
    : transaction.data?.successful === false ? `The transaction was included on ${SPOT_NETWORK.name} but the swap failed.`
    : executionError ? spotError(executionError) : "The transaction expired without confirmation. Review the swap again.";
  const close = useCallback(() => { if (!busy) setDialog("closed"); }, [busy]);
  useAccessibleOverlay(dialog !== "closed", close, dialogRef);
  useEffect(() => { if (dialog !== "closed") titleRef.current?.focus(); }, [dialog, stage]);
  useEffect(() => {
    if (busy || uncertain) return;
    const timer = window.setTimeout(() => setDialog("closed"), 0);
    return () => window.clearTimeout(timer);
  }, [wallet.address, wallet.network, wallet.walletNetwork]); // eslint-disable-line react-hooks/exhaustive-deps
  function changeAmount(value: string) {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setAmount(value); setInputError("");
  }
  function changeAsset(side: "pay" | "receive", asset: SpotAsset) {
    setImported(current => mergeSpotAssets(current, [asset]));
    if (side === "pay") setPay(asset); else setReceive(asset);
    setInputError(""); setRouteExpanded(false);
  }
  function execute() {
    if (!review?.quote.request.account || !ready || busy || uncertain || queryClient.isMutating({ mutationKey: swapKey })) return;
    if (!currentRequest || spotRequestKey(currentRequest) !== review.quote.key) { close(); return; }
    setDialog("execution");
    if (review.quote.source === "soroban") contractMutation.mutate(review);
    else swapMutation.mutate(review);
  }
  const assetDetailsReady = receive.kind === "native" || metadata.isSuccess;
  const ready = Boolean(quote && quoteStatus === "ready" && !quoteUpdating && assetDetailsReady && !validation && !amountError && !inputError && bps && accountStatus === "ready" && networkStatus === "ready");
  let status: { title: string; body: string; warning?: boolean } | undefined;
  if (networkStatus === "wrong") status = { title: "Wrong wallet network", body: "Switch your wallet to Stellar Mainnet before swapping.", warning: true };
  else if (networkStatus === "error") status = { title: `${SPOT_NETWORK.name} connection unavailable`, body: networkError ?? "Check the Stellar connection and retry." };
  else if (accountStatus === "unfunded") status = { title: `Unfunded ${SPOT_NETWORK.name} account`, body: `Fund your account on ${SPOT_NETWORK.name} before swapping.`, warning: true };
  else if (accountStatus === "error" && wallet.isAuthenticated) status = { title: "Balance unavailable", body: accountError ?? "The account balance could not be verified." };
  else if (amountError || inputError) status = { title: "Check the amount", body: inputError || amountError };
  else if (!bps) status = { title: "Check slippage", body: "Choose slippage between 0.01% and 5%, with up to two decimal places." };
  else if (pay.id === receive.id) status = { title: "Choose different assets", body: "Choose a different asset to receive." };
  else if (validation) status = { title: "Swap prerequisites", body: validation };
  else if (currentRequest && receive.kind === "classic" && metadata.isError) status = { title: "Asset details unavailable", body: "Asset permissions could not be checked. Try again shortly." };
  else if (quoteStatus === "no-route") status = { title: "No route available for this amount", body: "Try a smaller amount or choose another asset.", warning: true };
  else if (quoteStatus === "error") status = { title: "Quote unavailable", body: quoteError ?? "The native quote request failed. Try again." };
  const primaryLabel = uncertain ? "Check transaction status" : quoteStatus === "choose" ? "Choose a quote" : busy ? "Swap in progress…" : !units ? "Enter an amount" : validation ? "Check balance and reserves"
    : accountStatus === "unfunded" ? `Fund ${SPOT_NETWORK.name} account` : networkStatus === "wrong" ? `Switch wallet to ${SPOT_NETWORK.name}` : networkStatus === "error" ? `${SPOT_NETWORK.name} unavailable` : ["error", "no-route"].includes(quoteStatus) || ready ? "Review swap" : "Finding a route…";
  const feeCap = quote?.source === "soroban" ? SOROBAN_SPOT_FEE_CAP : requirements?.fee ?? BLUX_SWAP_FEE_PER_OPERATION * BigInt(receive.kind === "native" ? 1 : 2);
  const balanceLabel = (value?: bigint) => accountStatus === "loading" ? <SpotValueSkeleton>10,000.00</SpotValueSkeleton> : value === undefined ? "Unavailable" : formatSpotAmount(value);
  const explorer = submitted?.hash ? spotTransactionUrl(submitted.hash, SPOT_NETWORK_ID) : undefined;
  return <>
    <div className="spot-workspace"><section className="trade-panel swap-ticket" aria-labelledby="swap-title" data-details-expanded={feesExpanded}>
      <div className="trade-panel-header swap-ticket-head"><div><h2 className="trade-panel-title" id="swap-title">Swap assets</h2><p className="trade-panel-subtitle">Choose the assets you want to exchange.</p></div>
        <div className="slippage-control"><button className="trade-icon-button" type="button" aria-label="Slippage settings" aria-expanded={slippageOpen} disabled={busy || uncertain} onClick={() => setSlippageOpen(value => !value)}><Icon name="sliders" size={17} /></button>
          {slippageOpen && <div className="slippage-popover" role="group" aria-label="Slippage tolerance"><div className="slippage-popover-head"><span>Slippage tolerance</span><strong>{bps ? `${bps / 100}%` : "—"}</strong></div>
            <div className="trade-segmented slippage-presets">{[10, 30, 50, 100].map(value => <button type="button" key={value} className={bps === value ? "is-active" : ""} aria-pressed={bps === value} onClick={() => setSlippageInput(String(value / 100))}>{value / 100}%</button>)}</div>
            <label className="custom-slippage"><span>Custom</span><span className="trade-input-wrap"><input className="trade-input trade-number" inputMode="decimal" aria-label="Custom slippage percentage" value={slippageInput} aria-invalid={!bps} onChange={event => setSlippageInput(event.target.value)} /><span className="trade-input-affix">%</span></span></label>
          </div>}
        </div>
      </div>
      <div className="asset-fields"><div className={`asset-amount-card${amountError || validation ? " is-error" : ""}`}>
        <div className="amount-card-meta"><label className="amount-card-label" htmlFor="pay-amount">Pay</label>{wallet.isAuthenticated && <span className="amount-card-balance">Available <strong className="trade-number">{balanceLabel(balance)} {pay.code}</strong></span>}</div>
        <div className="amount-card-main"><span className="amount-input-viewport"><input id="pay-amount" className="amount-input" type="text" inputMode="decimal" autoComplete="off" maxLength={64} disabled={busy || uncertain} value={amount} style={{ width: `${Math.max(amount.length + 1, 5)}ch` }}
          onChange={event => changeAmount(event.target.value)} onBlur={() => { if (!amount) setInputError(""); else if (!amountError && units === BigInt("0")) setInputError("Enter an amount greater than zero."); }}
          onBeforeInput={event => { const text = (event.nativeEvent as InputEvent).data; if (!text) return; const field = event.currentTarget; const next = field.value.slice(0, field.selectionStart ?? 0) + text + field.value.slice(field.selectionEnd ?? field.value.length); if (!/^\d*\.?\d*$/.test(next)) event.preventDefault(); }}
          onPaste={event => { const field = event.currentTarget; const next = field.value.slice(0, field.selectionStart ?? 0) + event.clipboardData.getData("text") + field.value.slice(field.selectionEnd ?? field.value.length); if (!/^\d*\.?\d*$/.test(next)) event.preventDefault(); }}
          placeholder="0.00" aria-invalid={Boolean(amountError || validation || inputError)} aria-describedby={`pay-network-value${amountError || inputError ? " spot-amount-error" : ""}`} /></span>
          <SpotAssetSelector label="Choose pay asset" value={pay} assets={assets} canDiscover={validNetwork} disabled={busy || uncertain} onChange={asset => changeAsset("pay", asset)} />
        </div><div className="amount-card-footer"><span id="pay-network-value" title={pay.issuer}>{spotIssuerLabel(pay)}</span><button className={`spot-max${wallet.isAuthenticated ? "" : " spot-control-hidden"}`} type="button" disabled={busy || uncertain || !requirements} onClick={() => { if (balance !== undefined) { setAmount(spotDecimal(balance)); setInputError(""); } }}>MAX</button></div>
      </div>
        <button className="swap-direction-button" type="button" disabled={busy || uncertain} onClick={() => { setPay(receive); setReceive(pay); }} aria-label={`Reverse ${pay.code} and ${receive.code}`}><Icon name="arrow-down" size={18} /></button>
        <div className="asset-amount-card receive-card"><div className="amount-card-meta"><span className="amount-card-label">Receive</span>{wallet.isAuthenticated && <span className="amount-card-balance">Wallet <strong className="trade-number">{balanceLabel(receiveBalance)} {receive.code}</strong></span>}</div>
          <div className="amount-card-main"><output className={`amount-output${quote ? "" : " is-unavailable"}`} aria-label="Estimated receive amount" aria-busy={quoteLoading || quoteUpdating}>{quote ? formatSpotQuoteAmount(quote.output, 7) : quoteLoading ? <SpotValueSkeleton>0,000.0000000</SpotValueSkeleton> : "-"}</output><SpotAssetSelector label="Choose receive asset" value={receive} assets={assets} canDiscover={validNetwork} disabled={busy || uncertain} onChange={asset => changeAsset("receive", asset)} /></div>
          <div className="amount-card-footer receive-supporting-copy"><span title={receive.issuer}>{spotIssuerLabel(receive)}</span><span>{quote ? `1 ${pay.code} = ${spotRate(quote.output, quote.request.amount)} ${receive.code}` : quoteLoading ? <SpotValueSkeleton>1 {pay.code} = 0.00 {receive.code}</SpotValueSkeleton> : "Rate unavailable"}</span></div>
        </div>
      </div>
      {currentRequest && <SpotQuoteOptions quotes={quotes} selected={quote} disabled={busy || uncertain} loading={apiConfig.isPending || apiEnabled && apiQuotes.isFetching} apiEnabled={apiEnabled || apiConfig.isError}
        error={apiConfig.isError ? spotError(apiConfig.error) : apiEnabled && apiQuotes.isError ? spotError(apiQuotes.error) : undefined}
        onSelect={id => { setSelection({ key: selectionKey, id }); setRouteExpanded(false); }} onRetry={() => { if (apiConfig.isError) void apiConfig.refetch(); else if (apiEnabled) void refetchApiQuotes(); }} />}
      {selection?.key === selectionKey && !quote && quotes.length > 0 && <p className="spot-quote-notice" role="status">Your selected quote is no longer available. Choose a quote to continue.</p>}
      <div className="spot-quote-region" aria-busy={quoteLoading || quoteUpdating}>
      {!status && <section className="compact-route" aria-label="Execution route"><button className="compact-route-summary" type="button" disabled={!quote} aria-expanded={routeExpanded && Boolean(quote)} aria-controls="route-details" onClick={() => setRouteExpanded(value => !value)}>
        <span className="compact-route-copy"><span>{quoteUpdating ? "Updating quote (previous estimate)" : "Selected execution path"}</span><strong>{quote ? spotQuoteProtocols(quote) : quoteLoading ? <SpotValueSkeleton>{pay.code} → {receive.code}</SpotValueSkeleton> : "Enter an amount"}</strong></span>
        <span className="compact-route-view">View route<Icon name="chevron-down" size={15} className={routeExpanded ? "is-rotated" : ""} /></span>
      </button>
        {quote && <SpotAccordion open={routeExpanded} id="route-details"><div className="compact-route-details"><SpotRouteDetails quote={quote} />
        </div></SpotAccordion>}
      </section>}
      {status && <div className={`spot-status spot-status--${status.warning ? "warning" : "error"}`} role={status.warning ? "status" : "alert"} id={amountError || inputError ? "spot-amount-error" : undefined}><strong>{status.title}</strong><p>{status.body}</p></div>}
      </div>
      {uncertain && <div className="trade-alert trade-alert--warning" role="status"><div><strong>Awaiting verified confirmation</strong><p>{message}</p>{explorer && <a href={explorer} target="_blank" rel="noopener noreferrer">View {SPOT_NETWORK.name} transaction</a>}</div></div>}
      <div className="spot-transaction-info">
      <div className="fee-disclosure"><button className="fee-summary-toggle" type="button" aria-expanded={feesExpanded} aria-controls="spot-transaction-details" onClick={() => setFeesExpanded(value => !value)}><span>Transaction details</span><Icon name="chevron-down" size={17} className={feesExpanded ? "is-rotated" : ""} /></button>
        <SpotAccordion open={feesExpanded} id="spot-transaction-details"><dl className="trade-breakdown fee-detail-rows">
          <div className="trade-breakdown-row"><dt>Minimum received</dt><dd>{minimum ? formatSpotQuoteAmount(minimum) + " " + receive.code : quoteLoading ? <SpotValueSkeleton>0,000.00 {receive.code}</SpotValueSkeleton> : "—"}</dd></div>
          <div className="trade-breakdown-row"><dt>Slippage</dt><dd>{bps ? bps / 100 + "%" : "—"}</dd></div>
          <div className="trade-breakdown-row"><dt>Quoted output</dt><dd>{quote ? formatSpotQuoteAmount(quote.output) + " " + receive.code : quoteLoading ? <SpotValueSkeleton>0,000.00 {receive.code}</SpotValueSkeleton> : "—"}</dd></div>
          <div className="trade-breakdown-row"><dt>Network fee limit</dt><dd>{networkStatus === "checking" ? <SpotValueSkeleton>Up to 0.02 XLM</SpotValueSkeleton> : <>Up to {formatSpotFee(feeCap)} XLM</>}</dd></div>
        </dl></SpotAccordion>
      </div>
      </div>
      <div className="swap-primary-wrap"><button className={`trade-button trade-button--primary trade-button--lg trade-button--block${!wallet.isAuthenticated ? " wallet-connect-button" : ""}`} type="button" disabled={!wallet.isAuthenticated ? !wallet.isReady || wallet.isConnecting : busy || (!ready && !uncertain)} onClick={() => {
        if (!wallet.isAuthenticated) void wallet.connect(); else if (uncertain) { setDialog("execution"); void checkPending(); }
        else if (ready && quote && bps) { setReview({ quote, bps, fee: feeCap }); setDialog("review"); }
      }}>{!wallet.isAuthenticated ? wallet.isConnecting ? "Connecting…" : "Connect wallet" : primaryLabel}{ready && <Icon name="chevron-right" size={17} />}</button></div>
    </section></div>
    {dialog !== "closed" && (review || submitted) && createPortal(<div className="trade-scrim review-scrim" data-spot-review onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className={`trade-modal review-modal review-modal--${stage}`} role="dialog" aria-modal="true" aria-labelledby="spot-review-title">
        <div className="review-modal-head"><div><h2 id="spot-review-title" tabIndex={-1} ref={titleRef}>{stage === "review" ? "Confirm swap" : stage === "wallet" ? "Approve in wallet" : stage === "pending" ? `Confirming on ${SPOT_NETWORK.name}` : stage === "confirmed" ? "Swap complete" : stage === "cancelled" ? "Swap cancelled" : stage === "unconfirmed" ? "Confirmation unavailable" : "Swap not completed"}</h2><p>{stage === "review" ? "Review your swap before continuing." : stage === "confirmed" ? `Confirmed on ${SPOT_NETWORK.label}.` : busy ? submitted ? `Waiting for ${SPOT_NETWORK.label} confirmation.` : "Waiting for your required wallet approval." : message}</p></div>{!busy && <button className="trade-icon-button" type="button" onClick={close} aria-label="Close swap dialog"><Icon name="close" size={17} /></button>}</div>
        {stage === "review" && review && <><div className="spot-review-pair">
          {[review.quote.request.from, review.quote.request.to].map((asset, index) => <Fragment key={asset.id}>
            {index === 1 && <span className="spot-review-direction" aria-hidden="true"><Icon name="arrow-down" size={18} /></span>}
            <div className="spot-review-leg">
              <span className="spot-review-label">{index === 0 ? "You pay" : "You receive"}</span>
              <strong className="spot-review-amount trade-number">{index === 1 ? "≈ " : ""}{formatSpotQuoteAmount(index === 0 ? review.quote.request.amount : review.quote.output)}</strong>
              <div className="spot-review-token"><SpotTokenIcon asset={asset} /><div><strong>{asset.code}</strong><span>{asset.name}</span></div></div>
              <span className="spot-review-issuer" title={asset.issuer}>{spotIssuerLabel(asset)}</span>
            </div>
          </Fragment>)}
        </div>
          <dl className="trade-breakdown review-breakdown"><div className="trade-breakdown-row"><dt>Route</dt><dd>{spotQuoteProtocols(review.quote)}</dd></div><div className="trade-breakdown-row"><dt>Minimum received</dt><dd>{formatSpotQuoteAmount(spotCandidateMinimum(review.quote, review.bps))} {review.quote.request.to.code}</dd></div><div className="trade-breakdown-row"><dt>Slippage</dt><dd>{review.bps / 100}%</dd></div><div className="trade-breakdown-row"><dt>Network fee limit</dt><dd>Up to {formatSpotFee(review.fee)} XLM</dd></div><div className="trade-breakdown-row trade-breakdown-row--total"><dt>Network</dt><dd>{SPOT_NETWORK.label}</dd></div></dl>
          {review.quote.soroban && Date.parse(review.quote.soroban.expiresAt) <= (now) + 5000 && <p className="spot-quote-notice" role="status">This quote expired. Close and select a fresh quote.</p>}
          <div className="review-actions"><button className="trade-button trade-button--secondary" type="button" onClick={close}>Cancel</button><button className="trade-button trade-button--primary" type="button" disabled={busy || uncertain || !ready || Boolean(review.quote.soroban && Date.parse(review.quote.soroban.expiresAt) <= now + 5000)} onClick={execute}>Swap {review.quote.request.from.code} for {review.quote.request.to.code}<Icon name="chevron-right" size={16} /></button></div>
        </>}
        {busy && <div className="signature-request" role="status" aria-live="polite">
          <span className="pending-spinner" aria-hidden="true" />
          <div><strong>{submitted ? "Confirming transaction" : "Check your wallet"}</strong><p>{message}</p></div>
        </div>}
        {stage === "confirmed" && receipt && <><div className="transaction-result is-success" role="status">
          <span><Icon name="check" size={25} /></span>
          <div><strong className="trade-number">{receipt.received ? formatSpotAmount(receipt.received) : activity.isFetching ? <SpotValueSkeleton>0,000.00</SpotValueSkeleton> : "Confirmed"} {(submitted?.asset ?? receive).code}</strong><p>Swap confirmed on {SPOT_NETWORK.label}.</p></div>
        </div><dl className="trade-breakdown result-breakdown"><div className="trade-breakdown-row"><dt>Network fee charged</dt><dd>{formatSpotFee(receipt.fee)} XLM</dd></div><div className="trade-breakdown-row"><dt>Ledger</dt><dd>{receipt.ledger.toLocaleString("en-US")}</dd></div><div className="trade-breakdown-row trade-breakdown-row--total"><dt>Transaction</dt><dd>{explorer && <a href={explorer} target="_blank" rel="noopener noreferrer">{receipt.hash.slice(0, 8)}…{receipt.hash.slice(-6)}</a>}</dd></div></dl><button className="trade-button trade-button--primary trade-button--block review-complete-action" type="button" onClick={close}>Done</button></>}
        {["failed", "cancelled", "unconfirmed"].includes(stage) && <><div className="transaction-result is-failure"><span><Icon name="x" size={25} /></span><div><strong>{stage === "unconfirmed" ? "Check confirmation before retrying" : stage === "cancelled" ? "Wallet approval cancelled" : "Swap failed"}</strong><p>{message}</p></div></div>{explorer && <a href={explorer} target="_blank" rel="noopener noreferrer">View {SPOT_NETWORK.name} transaction</a>}<div className="review-actions"><button className="trade-button trade-button--secondary" type="button" onClick={close}>Close</button><button className="trade-button trade-button--primary" type="button" onClick={() => uncertain ? void checkPending() : (close(), void refresh())}>{uncertain ? "Check status" : "Refresh and retry"}</button></div></>}
      </section>
    </div>, document.body)}
  </>;
}
