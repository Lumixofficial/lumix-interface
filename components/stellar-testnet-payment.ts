import { StellarSdk } from "@bluxcc/react";
import { LUMIX_STELLAR_NETWORK } from "./stellar-network";

const STROOPS_PER_XLM = 10_000_000;
const MAX_STELLAR_DECIMALS = 7;
const DEFAULT_HORIZON_TIMEOUT_MS = 8_000;

type BalanceLine = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  selling_liabilities?: string;
  is_authorized?: boolean;
};

type HorizonAccount = {
  account_id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: BalanceLine[];
};

type HorizonFeeStats = {
  last_ledger_base_fee: string;
};

type HorizonLedgerPage = {
  _embedded?: {
    records?: Array<{ base_reserve_in_stroops?: number | string }>;
  };
};

export type PaymentValidationStep =
  | "source-account"
  | "destination-account"
  | "fee-stats"
  | "latest-ledger"
  | "transaction-status";

export type PaymentValidationDiagnostic = {
  step: PaymentValidationStep;
  status: "started" | "success" | "failure" | "timeout" | "cancelled";
  durationMs?: number;
  detail?: string;
};

export type PaymentValidationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onDiagnostic?: (diagnostic: PaymentValidationDiagnostic) => void;
};

export type TestnetPaymentPreview = {
  amount: string;
  assetCode: string;
  assetIssuer: string;
  destination: string;
  expectedHash: string;
  feeXlm: number;
  networkLabel: string;
  xdr: string;
};

export class PaymentPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentPreflightError";
  }
}

export class PaymentValidationCancelledError extends Error {
  constructor() {
    super("Payment validation was cancelled.");
    this.name = "PaymentValidationCancelledError";
  }
}

function validationStepLabel(step: PaymentValidationStep) {
  switch (step) {
    case "source-account": return "Connected account";
    case "destination-account": return "Destination account";
    case "fee-stats": return "Network fee";
    case "latest-ledger": return "Latest ledger";
    case "transaction-status": return "Transaction status";
  }
}

function emitDiagnostic(
  options: PaymentValidationOptions,
  diagnostic: PaymentValidationDiagnostic,
) {
  options.onDiagnostic?.(diagnostic);
  if (process.env.NODE_ENV !== "production") {
    console.debug("[Lumix payment validation]", {
      ...diagnostic,
      network: LUMIX_STELLAR_NETWORK.label,
    });
  }
}

async function requestHorizonJson<T>(
  path: string,
  step: PaymentValidationStep,
  options: PaymentValidationOptions,
): Promise<{ data?: T; status: number }> {
  if (options.signal?.aborted) throw new PaymentValidationCancelledError();

  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_HORIZON_TIMEOUT_MS);

  emitDiagnostic(options, { step, status: "started" });
  try {
    const response = await fetch(`${LUMIX_STELLAR_NETWORK.horizonUrl}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    if (response.status === 404) {
      emitDiagnostic(options, { step, status: "failure", durationMs, detail: "HTTP 404" });
      return { status: response.status };
    }
    if (!response.ok) {
      emitDiagnostic(options, { step, status: "failure", durationMs, detail: `HTTP ${response.status}` });
      throw new PaymentPreflightError(`${validationStepLabel(step)} check failed (HTTP ${response.status}). Retry validation.`);
    }

    const data = await response.json() as T;
    emitDiagnostic(options, { step, status: "success", durationMs });
    return { data, status: response.status };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (timedOut) {
      emitDiagnostic(options, { step, status: "timeout", durationMs });
      throw new PaymentPreflightError(`${validationStepLabel(step)} check timed out. Retry validation.`);
    }
    if (options.signal?.aborted) {
      emitDiagnostic(options, { step, status: "cancelled", durationMs });
      throw new PaymentValidationCancelledError();
    }
    if (error instanceof PaymentPreflightError) throw error;
    emitDiagnostic(options, {
      step,
      status: "failure",
      durationMs,
      detail: error instanceof Error ? error.name : "Request failed",
    });
    throw new PaymentPreflightError(`${validationStepLabel(step)} could not be reached. Check your connection and retry validation.`);
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

export function normalizeStellarAmount(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) {
    throw new PaymentPreflightError("Enter a valid USDC amount.");
  }

  const [wholePart = "0", fractionPart = ""] = normalized.split(".");
  if (fractionPart.length > MAX_STELLAR_DECIMALS) {
    throw new PaymentPreflightError("USDC payments support up to 7 decimal places.");
  }

  const whole = wholePart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");
  const amount = fraction ? `${whole}.${fraction}` : whole;
  if (Number(amount) <= 0) throw new PaymentPreflightError("Enter a USDC amount greater than zero.");
  return amount;
}

function findIssuedBalance(balances: readonly BalanceLine[]) {
  const { code, issuer } = LUMIX_STELLAR_NETWORK.assets.USDC;
  return balances.find((line) => (
    line.asset_type !== "native"
    && line.asset_code === code
    && line.asset_issuer === issuer
  ));
}

function findNativeBalance(balances: readonly BalanceLine[]) {
  return balances.find((line) => line.asset_type === "native");
}

function numeric(value: string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function preparePerpetualsTestnetPayment(
  sourceAddress: string,
  marginInput: string,
  options: PaymentValidationOptions = {},
): Promise<TestnetPaymentPreview> {
  if (LUMIX_STELLAR_NETWORK.id !== "testnet") {
    throw new PaymentPreflightError("Perpetuals demo payments are available only on Stellar Testnet.");
  }
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(sourceAddress)) {
    throw new PaymentPreflightError("Connect a standard Stellar testnet account to continue.");
  }

  const amount = normalizeStellarAmount(marginInput);
  const destination = LUMIX_STELLAR_NETWORK.destinations.perpetualsDemo;

  if (options.signal?.aborted) throw new PaymentValidationCancelledError();
  const validationController = new AbortController();
  const abortValidation = () => validationController.abort();
  options.signal?.addEventListener("abort", abortValidation, { once: true });
  let responses;
  try {
    responses = await Promise.all([
      requestHorizonJson<HorizonAccount>(`/accounts/${encodeURIComponent(sourceAddress)}`, "source-account", { ...options, signal: validationController.signal }),
      requestHorizonJson<HorizonAccount>(`/accounts/${encodeURIComponent(destination)}`, "destination-account", { ...options, signal: validationController.signal }),
      requestHorizonJson<HorizonFeeStats>("/fee_stats", "fee-stats", { ...options, signal: validationController.signal }),
      requestHorizonJson<HorizonLedgerPage>("/ledgers?order=desc&limit=1", "latest-ledger", { ...options, signal: validationController.signal }),
    ]);
  } catch (error) {
    validationController.abort();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortValidation);
  }

  const [sourceResponse, destinationResponse, feeResponse, ledgerResponse] = responses;
  if (sourceResponse.status === 404 || !sourceResponse.data) {
    throw new PaymentPreflightError("The connected account was not found on Stellar testnet.");
  }
  if (destinationResponse.status === 404 || !destinationResponse.data) {
    throw new PaymentPreflightError("The configured testnet payment destination is unavailable.");
  }
  if (!feeResponse.data || !ledgerResponse.data) {
    throw new PaymentPreflightError("Testnet network data is unavailable. Retry validation.");
  }

  const sourceAccount = sourceResponse.data;
  const destinationAccount = destinationResponse.data;
  if (sourceAccount.account_id !== sourceAddress || destinationAccount.account_id !== destination) {
    throw new PaymentPreflightError("The testnet account response did not match the validated payment.");
  }

  const baseFee = Number(feeResponse.data.last_ledger_base_fee);
  const latestLedger = ledgerResponse.data;
  if (!Number.isSafeInteger(baseFee) || baseFee <= 0) {
    throw new PaymentPreflightError("Testnet fee data is invalid. Retry validation.");
  }

  const sourceBalances = sourceAccount.balances;
  const sourceUsdc = findIssuedBalance(sourceBalances);
  if (!sourceUsdc) throw new PaymentPreflightError("Add the configured testnet USDC trustline before submitting.");
  if (sourceUsdc.is_authorized === false) {
    throw new PaymentPreflightError("Your testnet USDC trustline is not authorized by the issuer.");
  }

  const spendableUsdc = Math.max(0, numeric(sourceUsdc.balance) - numeric(sourceUsdc.selling_liabilities));
  if (spendableUsdc + Number.EPSILON < Number(amount)) {
    throw new PaymentPreflightError("Insufficient spendable testnet USDC for this margin payment.");
  }

  const destinationUsdc = findIssuedBalance(destinationAccount.balances);
  if (!destinationUsdc) {
    throw new PaymentPreflightError("The testnet destination cannot receive the configured USDC asset.");
  }
  if (destinationUsdc.is_authorized === false) {
    throw new PaymentPreflightError("The testnet destination USDC trustline is not authorized.");
  }

  const native = findNativeBalance(sourceBalances);
  if (!native) throw new PaymentPreflightError("Testnet XLM is required to pay the network fee.");

  const baseReserveStroops = Number(latestLedger._embedded?.records?.[0]?.base_reserve_in_stroops ?? 0);
  if (!Number.isFinite(baseReserveStroops) || baseReserveStroops <= 0) {
    throw new PaymentPreflightError("The latest testnet reserve data is invalid. Retry validation.");
  }
  const minimumBalanceXlm = ((2 + sourceAccount.subentry_count + sourceAccount.num_sponsoring - sourceAccount.num_sponsored)
    * baseReserveStroops) / STROOPS_PER_XLM;
  const spendableXlm = Math.max(
    0,
    numeric(native.balance) - numeric(native.selling_liabilities) - minimumBalanceXlm,
  );
  const feeXlm = baseFee / STROOPS_PER_XLM;
  if (spendableXlm + Number.EPSILON < feeXlm) {
    throw new PaymentPreflightError("Add testnet XLM to cover the Stellar network fee.");
  }

  const asset = new StellarSdk.Asset(
    LUMIX_STELLAR_NETWORK.assets.USDC.code,
    LUMIX_STELLAR_NETWORK.assets.USDC.issuer,
  );
  const transactionSource = new StellarSdk.Account(sourceAccount.account_id, sourceAccount.sequence);
  const transaction = new StellarSdk.TransactionBuilder(transactionSource, {
    fee: String(baseFee),
    networkPassphrase: LUMIX_STELLAR_NETWORK.passphrase,
  })
    .addOperation(StellarSdk.Operation.payment({ destination, asset, amount }))
    .addMemo(StellarSdk.Memo.text("Lumix perpetual demo"))
    .setTimeout(180)
    .build();

if (
  transaction.source !== sourceAddress
  || transaction.operations.length !== 1
) {
  throw new PaymentPreflightError(
    "The testnet payment could not be validated. Nothing was submitted.",
  );
}

const operation = transaction.operations[0];

if (!operation || operation.type !== "payment") {
  throw new PaymentPreflightError(
    "The testnet payment could not be validated. Nothing was submitted.",
  );
}

const builtAmount = normalizeStellarAmount(operation.amount);

if (
  operation.destination !== destination
  || builtAmount !== amount
  || !operation.asset.equals(asset)
) {
  if (process.env.NODE_ENV !== "production") {
    console.error("[Lumix payment validation mismatch]", {
      expected: {
        source: sourceAddress,
        destination,
        amount,
        asset: asset.toString(),
      },
      built: {
        source: transaction.source,
        destination: operation.destination,
        rawAmount: operation.amount,
        normalizedAmount: builtAmount,
        asset: operation.asset.toString(),
      },
    });
  }

  throw new PaymentPreflightError(
    "The testnet payment could not be validated. Nothing was submitted.",
  );
}

  return {
    amount,
    assetCode: LUMIX_STELLAR_NETWORK.assets.USDC.code,
    assetIssuer: LUMIX_STELLAR_NETWORK.assets.USDC.issuer,
    destination,
    expectedHash: Array.from(transaction.hash(), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    feeXlm,
    networkLabel: LUMIX_STELLAR_NETWORK.label,
    xdr: transaction.toXDR(),
  };
}

export async function isTestnetTransactionConfirmed(
  hash: string,
  options: PaymentValidationOptions = {},
) {
  const response = await requestHorizonJson<{ successful?: boolean }>(
    `/transactions/${encodeURIComponent(hash)}`,
    "transaction-status",
    options,
  );
  if (response.status === 404) return false;
  return response.data?.successful === true;
}

export function testnetTransactionUrl(hash: string) {
  return `${LUMIX_STELLAR_NETWORK.explorerBaseUrl}/tx/${hash}`;
}
