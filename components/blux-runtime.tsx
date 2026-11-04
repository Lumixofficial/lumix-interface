"use client";

import {
  BluxEvent,
  BluxProvider,
  events,
  networks,
  useBalances,
  useBlux,
  useNetwork,
} from "@bluxcc/react";
import {
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  BalanceStatus,
  WalletContextValue,
  WalletSubmittedTransaction,
} from "./wallet-provider";
import { APP_ROUTES } from "./app-routes";
import { LUMIX_PUBLIC_CONFIG } from "./runtime-config";
import { LUMIX_STELLAR_NETWORK, walletAssetKey } from "./stellar-network";
import { SPOT_NETWORK, SPOT_NETWORKS, SPOT_MAINNET_USDC_ISSUER } from "./spot-network";
import { circleTestnetUsdc } from "./spot-verified-assets.json";
import { clearSavedWallet, saveWallet } from "./wallet-session";

type LumixTheme = "dark" | "light";
type WalletBalanceLine = {
  asset_type: string;
  balance: string;
  asset_code?: string;
  asset_issuer?: string;
  selling_liabilities?: string;
};

// Horizon includes open-offer commitments as selling liabilities. Subtract
// those once to expose the amount the account can actually spend.
function spendableBalance(line: WalletBalanceLine) {
  const balance = Number(line.balance);
  const sellingLiabilities = Number(line.selling_liabilities ?? 0);
  if (!Number.isFinite(balance) || !Number.isFinite(sellingLiabilities)) return undefined;
  return Math.max(0, balance - sellingLiabilities);
}

function walletBalanceError(error: unknown, label: string) {
  if (!error) return "";
  const status = typeof error === "object" && "response" in error
    ? (error.response as { status?: unknown } | undefined)?.status
    : undefined;
  if (status === 404) return `This wallet address is not funded on ${label} yet.`;
  const message = error instanceof Error ? error.message : String(error);
  return message ? `The wallet balance could not be loaded on ${label}: ${message}` : `The wallet balance could not be loaded on ${label}.`;
}

const darkAppearance = {
  logo: "https://i.ibb.co/Kj8Rmyf7/lumix-logo-type-white.png",
  fontFamily: "'Inter Variable', Inter, sans-serif",
  textColor: "#f4f4f5",
  accentColor: "#2e5cff",
  background: "#0a0a0b",
  fieldBackground: "#141416",
  borderColor: "#2a2a2d",
  borderWidth: "1px",
  borderRadius: "28px",
  outlineColor: "#2a2a2d",
  outlineWidth: "2px",
  outlineRadius: "20px",
  backdropBlur: "8px",
  backdropColor: "rgba(0, 0, 0, 0.60)",
  boxShadow: "0 24px 64px rgba(0, 0, 0, 0.50)",
} as const;

const lightAppearance = {
  logo: "https://i.ibb.co/8gTSX5md/lumix-logo-type-black.png",
  fontFamily: "'Inter Variable', Inter, sans-serif",
  textColor: "#17171a",
  accentColor: "#244de0",
  background: "#fafafd",
  fieldBackground: "#eeeef2",
  borderColor: "#d8d8e0",
  borderWidth: "1px",
  borderRadius: "28px",
  outlineColor: "#d8d8e0",
  outlineWidth: "2px",
  outlineRadius: "20px",
  backdropBlur: "8px",
  backdropColor: "rgba(0, 0, 0, 0.52)",
  boxShadow: "0 24px 64px rgba(23, 23, 26, 0.18)",
} as const;

function useLumixTheme() {
  const [theme, setTheme] = useState<LumixTheme>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function WalletController({ onStateChange }: { onStateChange: Dispatch<SetStateAction<WalletContextValue>> }) {
  const blux = useBlux();
  const network = useNetwork();
  const providerReady = blux.isReady === true;
  const restoredAddress = blux.user?.address || undefined;
  const isAuthenticated = providerReady && blux.isAuthenticated && Boolean(restoredAddress);
  const address = isAuthenticated ? restoredAddress : undefined;
  const walletNetwork = isAuthenticated ? blux.user?.walletPassphrase : undefined;
  const isTestnet = network === networks.testnet
    && (!walletNetwork || walletNetwork === networks.testnet);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const balancesQuery = useBalances(
    {
      address,
      includeZeroBalances: true,
      network: network || LUMIX_STELLAR_NETWORK.passphrase,
    },
    {
      enabled: isAuthenticated,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
      refetchOnWindowFocus: "always",
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      retry: 1,
      staleTime: 0,
    },
  );
  const refetchBalances = balancesQuery.refetch;
  // The header always reports Mainnet USDC, independent of the active network.
  const mainnetBalancesQuery = useBalances(
    {
      address,
      includeZeroBalances: true,
      network: networks.mainnet,
    },
    {
      enabled: isAuthenticated,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
      refetchOnWindowFocus: "always",
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      retry: 1,
      staleTime: 0,
    },
  );
  const refetchMainnetBalances = mainnetBalancesQuery.refetch;

  // BluxProvider owns session hydration. Only persist its verified user;
  // an initially unauthenticated snapshot is not a failed restore or logout.
  useEffect(() => {
    if (!isAuthenticated || !address) return;
    saveWallet(address);
  }, [address, isAuthenticated]);

  useEffect(() => {
    // Authentication arrives asynchronously from the shared wallet store.
    if (isAuthenticated) queueMicrotask(() => setConnectionMessage(""));
  }, [address, isAuthenticated]);

  useEffect(() => {
    // Blux's modal-based login promise intentionally remains pending until a
    // user authenticates. The modal lifecycle, rather than that promise, owns
    // Lumix's short-lived button state so cancellation never leaves it stuck.
    const releaseConnectingState = () => setIsConnecting(false);
    const stopOpenedListener = events.on(BluxEvent.ModalOpened, releaseConnectingState);
    const stopClosedListener = events.on(BluxEvent.ModalClosed, releaseConnectingState);
    const stopLogoutListener = events.on(BluxEvent.LoggedOut, () => { clearSavedWallet(); releaseConnectingState(); });
    return () => {
      stopOpenedListener();
      stopClosedListener();
      stopLogoutListener();
    };
  }, []);

  const { assetBalances, balances } = useMemo<{
    assetBalances: Record<string, number>;
    balances: Record<string, number>;
  }>(() => {
    if (!isAuthenticated || !balancesQuery.data) return { assetBalances: {}, balances: {} };

    return (balancesQuery.data as WalletBalanceLine[]).reduce<{
      assetBalances: Record<string, number>;
      balances: Record<string, number>;
    }>((result, balance) => {
      const code = balance.asset_type === "native" ? "XLM" : balance.asset_code?.toUpperCase();
      if (!code) return result;

      const spendable = spendableBalance(balance);
      if (spendable === undefined) return result;
      const issuer = balance.asset_type === "native" ? undefined : balance.asset_issuer;
      result.assetBalances[walletAssetKey(code, issuer)] = spendable;

      // Only the canonical USDC trustline for this network can populate the
      // shared symbol balance. A same-symbol asset from another issuer cannot
      // be mistaken for spendable Lumix collateral.
      const usdcIssuer = network === LUMIX_STELLAR_NETWORK.passphrase ? LUMIX_STELLAR_NETWORK.assets.USDC.issuer
        : network === networks.mainnet ? SPOT_MAINNET_USDC_ISSUER : circleTestnetUsdc.issuer;
      if (code !== "USDC" || issuer === usdcIssuer) {
        result.balances[code] = spendable;
      }
      return result;
    }, { assetBalances: {}, balances: {} });
  }, [balancesQuery.data, isAuthenticated, network]);

  const mainnetUsdcBalance = useMemo(() => {
    if (!isAuthenticated || !mainnetBalancesQuery.data) return undefined;
    const line = (mainnetBalancesQuery.data as WalletBalanceLine[]).find((balance) => balance.asset_type !== "native"
      && balance.asset_code === "USDC" && balance.asset_issuer === SPOT_MAINNET_USDC_ISSUER);
    return line ? spendableBalance(line) : 0;
  }, [isAuthenticated, mainnetBalancesQuery.data]);
  const mainnetUsdcBalanceStatus: BalanceStatus = !isAuthenticated
    ? "idle"
    : mainnetBalancesQuery.isPending
      ? "loading"
      : mainnetBalancesQuery.isError
        ? "error"
        : "success";

  const balanceStatus: BalanceStatus = !isAuthenticated
    ? "idle"
    : balancesQuery.isPending
      ? "loading"
      : balancesQuery.isError
        ? "error"
        : "success";
  const balanceError = balanceStatus === "error" ? walletBalanceError(balancesQuery.error, network === networks.mainnet ? "Stellar Mainnet" : "Stellar Testnet") : "";

  const connect = useCallback(async () => {
    if (!blux.isReady || blux.isAuthenticated || isConnecting) return;
    setConnectionMessage("");
    setIsConnecting(true);
    void blux.login()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        const wasDismissed = ["cancel", "close", "dismiss", "abort", "reject"].some((term) => message.includes(term));
        setConnectionMessage(wasDismissed
          ? "Wallet connection cancelled."
          : "Wallet connection failed. Please try again.");
      })
      .finally(() => setIsConnecting(false));
  }, [blux, isConnecting]);

  const disconnect = useCallback(() => {
    clearSavedWallet();
    setConnectionMessage("");
    setIsConnecting(false);
    onStateChange((current) => ({
      ...current,
      address: undefined,
      balanceError: "",
      balances: {},
      balanceStatus: "idle",
      isAuthenticated: false,
      isConnecting: false,
      mainnetUsdcBalance: undefined,
      mainnetUsdcBalanceStatus: "idle",
    }));
    blux.logout();
  }, [blux, onStateChange]);

  const openProfile = useCallback(() => {
    if (!isAuthenticated) return;
    blux.profile();
  }, [blux, isAuthenticated]);

  const refreshBalances = useCallback(async () => {
    if (!isAuthenticated) return;
    await Promise.all([refetchBalances(), refetchMainnetBalances()]);
  }, [isAuthenticated, refetchBalances, refetchMainnetBalances]);

  const sendTransaction = useCallback(async (xdr: string): Promise<WalletSubmittedTransaction> => {
    if (!isAuthenticated) throw new Error("Wallet is not connected.");
    const result = await blux.sendTransaction(xdr, { network: LUMIX_STELLAR_NETWORK.passphrase });
    if (!result || typeof result !== "object" || !("hash" in result) || typeof result.hash !== "string") {
      throw new Error("The wallet did not return a submitted transaction hash.");
    }
    return { hash: result.hash };
  }, [blux, isAuthenticated]);

  const clearConnectionMessage = useCallback(() => setConnectionMessage(""), []);
  const getBalance = useCallback((assetCode: string, assetIssuer?: string) => {
    if (!isAuthenticated || balanceStatus !== "success") return undefined;
    if (assetIssuer) return assetBalances[walletAssetKey(assetCode, assetIssuer)];
    return balances[assetCode.toUpperCase()];
  }, [assetBalances, balanceStatus, balances, isAuthenticated]);

  const walletState = useMemo<WalletContextValue>(() => ({
    address,
    balanceError,
    balances,
    balanceStatus,
    connectionMessage,
    isAuthenticated,
    isConnecting,
    isReady: providerReady,
    isTestnet,
    mainnetUsdcBalance,
    mainnetUsdcBalanceStatus,
    network,
    walletNetwork,
    clearConnectionMessage,
    connect,
    disconnect,
    getBalance,
    openProfile,
    refreshBalances,
    sendTransaction,
  }), [address, balanceError, balanceStatus, balances, clearConnectionMessage, connect, connectionMessage, disconnect, getBalance, isAuthenticated, isConnecting, isTestnet, mainnetUsdcBalance, mainnetUsdcBalanceStatus, network, openProfile, providerReady, refreshBalances, sendTransaction, walletNetwork]);

  useEffect(() => {
    onStateChange(walletState);
  }, [onStateChange, walletState]);

  return connectionMessage ? (
    <div className="wallet-connection-message" role="status" aria-live="polite">
      <span>{connectionMessage}</span>
      <button type="button" onClick={clearConnectionMessage} aria-label="Dismiss wallet connection message">Dismiss</button>
    </div>
  ) : null;
}

export function BluxRuntime({ onStateChange, children }: { onStateChange: Dispatch<SetStateAction<WalletContextValue>>; children: ReactNode }) {
  const theme = useLumixTheme();
  // This runtime only loads in the browser. Booting a Spot page directly on
  // Mainnet avoids a first render on the app-wide network before Spot switches.
  const [defaultNetwork] = useState(() => window.location.pathname.startsWith(APP_ROUTES.spot)
    ? SPOT_NETWORK.passphrase
    : LUMIX_STELLAR_NETWORK.passphrase);
  const config = useMemo<ComponentProps<typeof BluxProvider>["config"]>(() => ({
    appName: "Lumix",
    appId: LUMIX_PUBLIC_CONFIG.bluxAppId,
    networks: [networks.testnet, networks.mainnet],
    defaultNetwork,
    transports: {
      [networks.mainnet]: {
        horizon: SPOT_NETWORKS.mainnet.horizonUrl,
        soroban: SPOT_NETWORKS.mainnet.sorobanRpcUrl,
      },
      [networks.testnet]: {
        horizon: SPOT_NETWORKS.testnet.horizonUrl,
        soroban: SPOT_NETWORKS.testnet.sorobanRpcUrl,
      },
    },
    explorer: LUMIX_STELLAR_NETWORK.explorer,
    promptOnWrongNetwork: true,
    showWalletUIs: false,
    // In 0.3.10 this flag makes the modal sticky, not the session persistent.
    // createConfig automatically validates and restores Blux's saved session.
    isPersistent: false,
    loginMethods: ["wallet", "email", "google"],
    appearance: theme === "light" ? lightAppearance : darkAppearance,
  }), [defaultNetwork, theme]);

  return (
    <BluxProvider config={config}>
      <WalletController onStateChange={onStateChange} />
      {children}
    </BluxProvider>
  );
}
