import { StrKey } from "@stellar/stellar-sdk/base";

const walletTypeKey = "lumix_wallet_type";
const walletAddressKey = "lumix_wallet_address";
const legacyConnectionKey = "lumix_wallet_connected";

function browserStorage() {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function readSavedWallet(storage = browserStorage()) {
  try {
    const type = storage?.getItem(walletTypeKey) ?? storage?.getItem(legacyConnectionKey);
    const address = storage?.getItem(walletAddressKey);
    return type === "blux" && address && (StrKey.isValidEd25519PublicKey(address) || StrKey.isValidMed25519PublicKey(address))
      ? { type: "blux" as const, address } : undefined;
  } catch { return undefined; }
}

export function saveWallet(address: string, storage = browserStorage()) {
  try {
    storage?.setItem(walletAddressKey, address);
    storage?.setItem(walletTypeKey, "blux");
    storage?.setItem(legacyConnectionKey, "blux");
  } catch { /* The active connection still works when browser storage is blocked. */ }
}

export function clearSavedWallet(storage = browserStorage()) {
  try {
    storage?.removeItem(walletTypeKey);
    storage?.removeItem(walletAddressKey);
    storage?.removeItem(legacyConnectionKey);
  } catch { /* Disconnect must also work when browser storage is blocked. */ }
}
