const { Address, Asset, StrKey, nativeToScVal, xdr } = require('@stellar/stellar-sdk');
function spotSacFixture(asset, passphrase, { address = asset.contractId(passphrase), wasm = false, metadataAsset = asset } = {}) {
  const info = metadataAsset.isNative() ? ['Native'] : [metadataAsset.code.length <= 4 ? 'AlphaNum4' : 'AlphaNum12', {
    asset_code: metadataAsset.code, issuer: StrKey.decodeEd25519PublicKey(metadataAsset.issuer),
  }];
  const val = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(info[0]), ...(info[1] ? [nativeToScVal(info[1])] : [])]);
  const entry = xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
    ext: xdr.ExtensionPoint.v0(), contract: Address.fromString(address).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent,
    val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({
      executable: wasm ? xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)) : xdr.ContractExecutable.contractExecutableStellarAsset(),
      storage: [new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('AssetInfo')]), val })],
    })),
  }));
  return { address, xdr: entry.toXDR('base64') };
}
module.exports = { spotSacFixture };
