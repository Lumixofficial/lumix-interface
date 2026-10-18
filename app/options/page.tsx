import type { Metadata } from "next";
import { OptionsWorkspace } from "@/components/options-workspace";

export const metadata: Metadata = {
  title: "Options | Lumix",
  description: "Explore standardized crypto options across expiration dates and strikes.",
};

export default function OptionsPage() {
  return (
    <main className="options-page trade-container">
      <OptionsWorkspace />
    </main>
  );
}
