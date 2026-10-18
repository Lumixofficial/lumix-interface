"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useWallet } from "@/components/wallet-provider";
import { SpotCardLoading } from "@/components/spot-loading";
import "./spot.css";

const loadWorkspace = () => import("@/components/spot-workspace").then(module => module.SpotWorkspace);
const SpotWorkspace = dynamic(loadWorkspace, { ssr: false, loading: SpotCardLoading });

export default function SpotPage() {
  const wallet = useWallet();
  // Download the page's SDK chunk alongside wallet startup, not after it.
  useEffect(() => { void loadWorkspace(); }, []);
  return (
    <main className="spot-page trade-container">
      <div className="spot-intro">
        <div>
          <h1>Spot</h1>
          <p>Swap your assets.</p>
        </div>
      </div>
      {wallet.isReady ? <SpotWorkspace /> : <SpotCardLoading />}
    </main>
  );
}
