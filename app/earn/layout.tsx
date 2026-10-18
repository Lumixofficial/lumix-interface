import type { ReactNode } from "react";
import { FeatureRoute } from "@/components/feature-route";
import { EarnProvider } from "@/components/earn-provider";
import "./earn.css";
import "./detail.css";

export default function EarnVaultsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <FeatureRoute feature="earnVaults"><EarnProvider>{children}</EarnProvider></FeatureRoute>;
}
