"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { AppRouteTracker } from "./app-navigation";

export type BalanceStatus = "idle" | "loading" | "success" | "error";

export type WalletSubmittedTransaction = {
  hash: string;
};

export type WalletContextValue = {
  address?: string;
  balances: Readonly<Record<string, number>>;
  balanceError: string;
  balanceStatus: BalanceStatus;
  connectionMessage: string;
  isAuthenticated: boolean;
  isConnecting: boolean;
  isReady: boolean;
  isTestnet: boolean;
  mainnetUsdcBalance?: number;
  mainnetUsdcBalanceStatus: BalanceStatus;
  network: string;
  walletNetwork?: string;
  clearConnectionMessage: () => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  getBalance: (assetCode: string, assetIssuer?: string) => number | undefined;
  openProfile: () => void;
  refreshBalances: () => Promise<void>;
  sendTransaction: (xdr: string) => Promise<WalletSubmittedTransaction>;
};

const disconnectedWallet: WalletContextValue = {
  balances: {},
  balanceError: "",
  balanceStatus: "idle",
  connectionMessage: "",
  isAuthenticated: false,
  isConnecting: false,
  isReady: false,
  isTestnet: false,
  mainnetUsdcBalanceStatus: "idle",
  network: "",
  clearConnectionMessage: () => undefined,
  connect: async () => undefined,
  disconnect: () => undefined,
  getBalance: () => undefined,
  openProfile: () => undefined,
  refreshBalances: async () => undefined,
  sendTransaction: async () => { throw new Error("Wallet is not connected."); },
};

const WalletContext = createContext<WalletContextValue>(disconnectedWallet);

export function AppProviders({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletContextValue>(disconnectedWallet);
  const [Runtime, setRuntime] = useState<typeof import("./blux-runtime").BluxRuntime>();

  // The SDK imports browser-only code. Keep the app shell server-rendered,
  // then share its existing provider with the page's React hooks after boot.
  useEffect(() => {
    let mounted = true;
    void import("./blux-runtime").then(module => {
      if (mounted) setRuntime(() => module.BluxRuntime);
    });
    return () => { mounted = false; };
  }, []);

  return (
    <WalletContext.Provider value={wallet}>
      <AppRouteTracker />
      {Runtime ? <Runtime onStateChange={setWallet}>{children}</Runtime> : children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
