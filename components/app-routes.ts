export const APP_ROUTES = {
  home: "/spot",
  spot: "/spot",
  options: "/options",
  perpetuals: "/perpetuals",
  earnVaults: "/earn",
  portfolio: "/portfolio",
} as const;

export const FEATURES = {
  spot: { label: "Spot", route: APP_ROUTES.spot, comingSoon: false },
  options: { label: "Options", route: APP_ROUTES.options, comingSoon: true },
  perpetuals: { label: "Perpetuals", route: APP_ROUTES.perpetuals, comingSoon: true },
  earnVaults: { label: "Earn", route: APP_ROUTES.earnVaults, comingSoon: true },
  portfolio: { label: "Portfolio", route: APP_ROUTES.portfolio, comingSoon: true },
} as const;

export type FeatureId = keyof typeof FEATURES;
export type ProductNavigationLabel = (typeof FEATURES)[FeatureId]["label"];

export const PRODUCT_NAVIGATION = Object.values(FEATURES);

export const LAST_AVAILABLE_ROUTE_STORAGE_KEY = "lumix:last-available-route";

export function isAvailableProductRoute(pathname: string) {
  return PRODUCT_NAVIGATION.some((feature) => !feature.comingSoon && feature.route === pathname);
}

export function resolveAvailableReturnRoute(candidate: string | null | undefined) {
  return candidate && isAvailableProductRoute(candidate) ? candidate : APP_ROUTES.home;
}
