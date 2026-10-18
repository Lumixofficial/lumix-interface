import type { Metadata } from "next";
import { PerpetualsWorkspace } from "@/components/perpetuals-workspace";

export const metadata: Metadata = {
  title: "Perpetuals | Lumix",
  description: "Explore leveraged perpetual markets with inspectable risk controls.",
};

export default function PerpetualsPage() {
  return (
    <main className="perpetuals-page trade-container">
      <PerpetualsWorkspace />
    </main>
  );
}
