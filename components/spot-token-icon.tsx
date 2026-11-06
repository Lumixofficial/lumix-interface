"use client";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { spotCurrencyImage, spotHomeDomain, spotRead, type SpotAsset } from "./spot-utils";

export function SpotTokenIcon({ asset }: { asset: SpotAsset }) {
  // Local artwork also renders in the static card, before the query provider mounts.
  if (asset.icon || asset.kind !== "classic" || asset.unavailableReason) return <TokenImage key={asset.id} asset={asset} src={asset.icon} />;
  return <IssuerTokenImage asset={asset} />;
}
function IssuerTokenImage({ asset }: { asset: SpotAsset }) {
  const cache = { staleTime: 3_600_000, gcTime: 3_600_000, retry: false, retryOnMount: false, refetchOnWindowFocus: false } as const;
  const issuer = useQuery({
    ...cache, queryKey: ["lumix", "spot", "icon-issuer", asset.network, asset.issuer],
    queryFn: async ({ signal }) => {
      try { return await spotRead<{ account_id: string; home_domain?: string }>(`/accounts/${asset.issuer}`, signal, asset.network); }
      catch { return null; } // Cache missing/blocked optional metadata as well as successful lookups.
    },
  });
  const domain = issuer.data?.account_id === asset.issuer ? spotHomeDomain(issuer.data?.home_domain) : undefined;
  const metadata = useQuery({
    ...cache, queryKey: ["lumix", "spot", "icon-metadata", asset.network, domain], enabled: Boolean(domain),
    queryFn: async () => {
      try {
        const { StellarToml } = await import("@stellar/stellar-sdk");
        return await StellarToml.Resolver.resolve(domain!, { allowHttp: false, timeout: 6000, allowedRedirects: 0 });
      } catch { return null; }
    },
  });
  const src = spotCurrencyImage(metadata.data, asset);
  return <TokenImage key={`${asset.id}:${src ?? "fallback"}`} asset={asset} src={src} />;
}
function TokenImage({ asset, src }: { asset: SpotAsset; src?: string }) {
  const [broken, setBroken] = useState(false);
  // A failed SSR image may finish before React attaches onError during hydration.
  const captureImage = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setBroken(true);
  }, []);
  return <span className={`spot-token-icon${asset.kind === "native" && !broken ? " spot-token-icon--native" : ""}`} aria-hidden="true">
    {src && !broken
      // Images remain optional and never confer verification on an asset.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img ref={captureImage} src={src} alt="" width={28} height={28} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      : <span>{asset.code.slice(0, 2)}</span>}
  </span>;
}
