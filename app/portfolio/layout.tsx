import type { ReactNode } from "react";
import { FeatureRoute } from "@/components/feature-route";

export default function PortfolioLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <FeatureRoute feature="portfolio" shellClassName="portfolio-shell">{children}</FeatureRoute>;
}
