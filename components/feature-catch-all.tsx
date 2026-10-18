import { notFound, redirect } from "next/navigation";
import { FEATURES, type FeatureId } from "./app-routes";

export function FeatureCatchAll({ feature }: { feature: FeatureId }): never {
  const { comingSoon, route } = FEATURES[feature];
  if (!comingSoon) notFound();
  // Sub-paths have no preview of their own, so gated deep links land on the feature's blurred preview.
  redirect(route);
}
