import type { Metadata } from "next";
import { PortfolioWorkspace } from "@/components/portfolio-workspace";

export const metadata: Metadata = { title: "Portfolio | Lumix", description: "Your trading history and recorded realized P&L on Stellar testnet." };

export default function PortfolioPage() {
  return <main className="portfolio-page trade-container"><PortfolioWorkspace /></main>;
}
