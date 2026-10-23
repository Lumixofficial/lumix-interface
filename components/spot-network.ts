import { LUMIX_STELLAR_NETWORK } from "./stellar-network";
import { STELLAR_NETWORK_DEFAULTS, type StellarNetworkId } from "./runtime-config";

export type SpotNetworkId = StellarNetworkId;
// Spot trades only on Stellar Mainnet, whatever network NEXT_PUBLIC_STELLAR_NETWORK
// selects for the rest of the app.
export const SPOT_NETWORK_ID = "mainnet" satisfies SpotNetworkId;
export const SPOT_MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const SPOT_MAINNET_EURC_ISSUER = "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2";
export const SPOT_NETWORKS = {
  testnet: {
    ...STELLAR_NETWORK_DEFAULTS.testnet,
    ...(LUMIX_STELLAR_NETWORK.id === "testnet" ? LUMIX_STELLAR_NETWORK : {}),
  },
  mainnet: {
    ...STELLAR_NETWORK_DEFAULTS.mainnet,
    sorobanRpcUrl: process.env.NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL || STELLAR_NETWORK_DEFAULTS.mainnet.sorobanRpcUrl,
    ...(LUMIX_STELLAR_NETWORK.id === "mainnet" ? LUMIX_STELLAR_NETWORK : {}),
  },
} as const;
export const SPOT_NETWORK = SPOT_NETWORKS[SPOT_NETWORK_ID];
export const spotNetwork = (id: SpotNetworkId = SPOT_NETWORK_ID) => SPOT_NETWORKS[id];
