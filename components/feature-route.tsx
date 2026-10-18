import type { ReactNode } from "react";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { FEATURES, type FeatureId } from "./app-routes";
import { ComingSoonGate } from "./coming-soon-gate";

type FeatureRouteProps = {
  feature: FeatureId;
  shellClassName?: string;
  children: ReactNode;
};

export function FeatureRoute({ feature, shellClassName = "min-h-screen", children }: FeatureRouteProps) {
  const { label, comingSoon } = FEATURES[feature];
  return (
    <div className={`trade-app-shell ${shellClassName}`}>
      <AppHeader activeItem={label} />
      {comingSoon ? <ComingSoonGate feature={feature}>{children}</ComingSoonGate> : children}
      <AppFooter />
    </div>
  );
}
