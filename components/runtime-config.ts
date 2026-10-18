export const STELLAR_NETWORK_DEFAULTS = {
  testnet: {
    id: "testnet", label: "Stellar Testnet", name: "Testnet",
    passphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    explorerBaseUrl: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    id: "mainnet", label: "Stellar Mainnet", name: "Mainnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
    explorerBaseUrl: "https://stellar.expert/explorer/public",
  },
} as const;

export type StellarNetworkId = keyof typeof STELLAR_NETWORK_DEFAULTS;

function stellarNetwork(value: string | undefined): StellarNetworkId {
  const normalized = value?.trim().toLowerCase() || "testnet";
  if (normalized !== "testnet" && normalized !== "mainnet") {
    throw new Error("[Lumix configuration] NEXT_PUBLIC_STELLAR_NETWORK must be mainnet or testnet.");
  }
  return normalized;
}

const network = stellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK);

function required(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`[Lumix configuration] Missing required environment variable: ${name}.`);
  }
  return normalized;
}

function httpsUrl(name: string, value: string | undefined) {
  const normalized = required(name, value);
  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`[Lumix configuration] ${name} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`[Lumix configuration] ${name} must be an HTTPS URL without credentials.`);
  }

  return parsed.toString().replace(/\/$/, "");
}

function stellarAddress(name: string, value: string | undefined, prefix: "G" | "C") {
  const normalized = required(name, value).toUpperCase();
  if (!new RegExp(`^${prefix}[A-Z2-7]{55}$`).test(normalized)) {
    throw new Error(`[Lumix configuration] ${name} must be a valid Stellar ${prefix === "G" ? "account" : "contract"} address.`);
  }
  return normalized;
}

function optionalContract(name: string, value: string | undefined) {
  return value?.trim() ? stellarAddress(name, value, "C") : undefined;
}

export const LUMIX_PUBLIC_CONFIG = {
  bluxAppId: required("NEXT_PUBLIC_BLUX_APP_ID", process.env.NEXT_PUBLIC_BLUX_APP_ID),
  stellar: {
    ...STELLAR_NETWORK_DEFAULTS[network],
    horizonUrl: httpsUrl(
      "NEXT_PUBLIC_STELLAR_HORIZON_URL",
      process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
    ),
    sorobanRpcUrl: httpsUrl(
      "NEXT_PUBLIC_STELLAR_RPC_URL",
      process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    ),
    explorerBaseUrl: httpsUrl(
      "NEXT_PUBLIC_STELLAR_EXPLORER_URL",
      process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL,
    ),
    usdcIssuer: stellarAddress(
      "NEXT_PUBLIC_STELLAR_USDC_ISSUER",
      process.env.NEXT_PUBLIC_STELLAR_USDC_ISSUER,
      "G",
    ),
    usdcSacAddress: stellarAddress(
      "NEXT_PUBLIC_STELLAR_USDC_SAC_ADDRESS",
      process.env.NEXT_PUBLIC_STELLAR_USDC_SAC_ADDRESS,
      "C",
    ),
    optionsContractAddress: optionalContract(
      "NEXT_PUBLIC_STELLAR_OPTIONS_CONTRACT_ADDRESS",
      process.env.NEXT_PUBLIC_STELLAR_OPTIONS_CONTRACT_ADDRESS,
    ),
    perpetualsContractAddress: optionalContract(
      "NEXT_PUBLIC_STELLAR_PERPETUALS_CONTRACT_ADDRESS",
      process.env.NEXT_PUBLIC_STELLAR_PERPETUALS_CONTRACT_ADDRESS,
    ),
    perpetualsPaymentDestination: stellarAddress(
      "NEXT_PUBLIC_PERPETUALS_PAYMENT_DESTINATION",
      process.env.NEXT_PUBLIC_PERPETUALS_PAYMENT_DESTINATION,
      "G",
    ),
  },
} as const;
