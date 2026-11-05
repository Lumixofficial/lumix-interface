"use client";

import { useCallback, useEffect, useState } from "react";
import { deduplicate, parsePortfolioRecords, type PaymentRecord, type PortfolioRecords } from "./portfolio-records";
import { portfolioStorageKey, queueConfirmedPayment, readPortfolioRecords } from "./portfolio-storage";

const CHANGE_EVENT = "lumix-portfolio-records";
const unsaved = new Map<string, PortfolioRecords>();

type Snapshot = { wallet: string; status: "ready" | "error"; data: PortfolioRecords | null };

export function usePortfolioRecords(wallet: string | undefined) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const reload = useCallback(() => {
    if (!wallet) { setSnapshot(null); return; }
    try {
      const pending = unsaved.get(wallet);
      if (pending) { localStorage.setItem(portfolioStorageKey(wallet), JSON.stringify(pending)); unsaved.delete(wallet); }
      setSnapshot({ wallet, status: "ready", data: readPortfolioRecords(wallet) });
    }
    catch { setSnapshot({ wallet, status: "error", data: null }); }
  }, [wallet]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the wallet-scoped external storage only after SSR, then subscribe to changes.
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || (wallet && (event.key === portfolioStorageKey(wallet) || event.key === `${portfolioStorageKey(wallet)}:pending-payments`))) reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, reload);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(CHANGE_EVENT, reload); };
  }, [reload, wallet]);

  const update = useCallback((change: (current: PortfolioRecords) => PortfolioRecords) => {
    if (!wallet) return false;
    try {
      const next = change(unsaved.get(wallet) ?? readPortfolioRecords(wallet));
      next.spot = deduplicate(next.spot);
      next.payments = deduplicate(next.payments);
      next.outcomes = deduplicate(next.outcomes);
      const serialized = JSON.stringify(next);
      parsePortfolioRecords(serialized, wallet);
      unsaved.set(wallet, next);
      localStorage.setItem(portfolioStorageKey(wallet), serialized);
      unsaved.delete(wallet);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      setSnapshot({ wallet, status: "error", data: null });
      return false;
    }
  }, [wallet]);

  const recordPayment = useCallback((payment: PaymentRecord) => {
    if (!wallet) return;
    queueConfirmedPayment(wallet, payment);
    reload();
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [wallet, reload]);

  // Render-time identity check prevents even one frame of a previous wallet's data.
  const current = wallet && snapshot?.wallet === wallet ? snapshot : null;
  return { data: current?.data ?? null, status: !wallet ? "disconnected" : current?.status ?? "loading", update, reload, recordPayment } as const;
}
