import { LUMIX_STELLAR_NETWORK } from "./stellar-network";
import { STELLAR_NETWORK_DEFAULTS, type StellarNetworkId } from "./runtime-config";

export type SpotNetworkId = StellarNetworkId;
export const SPOT_DEFAULT_NETWORK = LUMIX_STELLAR_NETWORK.id;
export const SPOT_MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const SPOT_NETWORKS = {
  testnet: {
    ...STELLAR_NETWORK_DEFAULTS.testnet,
    ...(SPOT_DEFAULT_NETWORK === "testnet" ? LUMIX_STELLAR_NETWORK : {}),
  },
  mainnet: {
    ...STELLAR_NETWORK_DEFAULTS.mainnet,
    sorobanRpcUrl: process.env.NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL || STELLAR_NETWORK_DEFAULTS.mainnet.sorobanRpcUrl,
    ...(SPOT_DEFAULT_NETWORK === "mainnet" ? LUMIX_STELLAR_NETWORK : {}),
  },
} as const;
export const spotNetwork = (id: SpotNetworkId = SPOT_DEFAULT_NETWORK) => SPOT_NETWORKS[id];
