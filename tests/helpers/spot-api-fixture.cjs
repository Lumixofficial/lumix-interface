const { Asset, Networks, StrKey } = require('@stellar/stellar-sdk');
const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const aggregator = StrKey.encodeContract(Buffer.alloc(32, 5));
const contract = byte => StrKey.encodeContract(Buffer.alloc(32, byte));
const raw = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, '0')); };
const decimal = value => `${value / 10000000n}.${(value % 10000000n).toString().padStart(7, '0')}`;
function spotApiFixture(sender, { amount = '100', output = '102', bps = 30, split = true, expires = Math.floor(Date.now() / 1000) + 120 } = {}) {
  const input = Asset.native().contractId(Networks.PUBLIC), out = new Asset('USDC', issuer).contractId(Networks.PUBLIC);
  const mid = contract(6), minimum = raw(output) * BigInt(10000 - bps) / 10000n;
  const legs = (split ? [60, 40] : [100]).map((share, index) => {
    const amountInRaw = raw(amount) * BigInt(share) / 100n, amountOutRaw = raw(output) * BigInt(share) / 100n;
    const minimumReceivedRaw = minimum * BigInt(share) / 100n;
    const path = index === 0 && split ? [input, mid, out] : [input, out];
    return { routeId: 'route-' + index, amountIn: decimal(amountInRaw), amountInRaw: String(amountInRaw),
      amountOut: decimal(amountOutRaw), amountOutRaw: String(amountOutRaw), minimumReceived: decimal(minimumReceivedRaw), minimumReceivedRaw: String(minimumReceivedRaw),
      sharePct: String(share), path, pathSymbols: path.length === 3 ? ['XLM', 'AQUA', 'USDC'] : ['XLM', 'USDC'], allocationBasis: 'input', priceImpactPct: '0.1', isEstimate: false,
      hops: path.slice(0, -1).map((token, hop) => ({ poolAddress: contract(10 + index * 4 + hop), tokenIn: token, tokenOut: path[hop + 1],
        protocol: index === 0 ? 'soroswap' : 'aquarius', model: 'constant-product', amountInRaw: String(amountInRaw), amountOutRaw: String(amountOutRaw),
        feeRaw: '1000', feeToken: token, feeBps: '30', ledger: 100, updatedAt: new Date().toISOString(), tvlUsd: '1000', coverage: 'full', isEstimate: false })),
    };
  });
  const quote = { id: split ? 'split-quote' : 'single-quote', mode: 'exact-in', type: split ? 'split' : 'single',
    amountIn: amount, amountInRaw: String(raw(amount)), amountOut: output, amountOutRaw: String(raw(output)), minimumReceived: decimal(minimum), minimumReceivedRaw: String(minimum),
    maximumInput: null, maximumInputRaw: null, feeBps: 0, feePct: 0, feeAmountRaw: '0', grossAmountOutRaw: String(raw(output)),
    priceImpactPct: '0.1', expiresAt: new Date(expires * 1000).toISOString(), isEstimate: false, ledgers: { min: 100, max: 100 },
    settlement: { outputToken: out, feeToken: out, refundTokens: [] }, legs,
    txData: { address: aggregator, fn: 'swap_exact_in', args: [{ sender, recipient: null, token_in: input, token_out: out,
      amount: String(raw(amount)), limit: String(minimum), deadline: String(expires), fee_bps: 0,
      legs: legs.map(leg => ({ amount: leg.amountInRaw, limit: leg.minimumReceivedRaw, hops: leg.hops.map(hop => ({ pool: hop.poolAddress, protocol: { tag: hop.protocol === "soroswap" ? "Soroswap" : "Aquarius" },
        token_in: hop.tokenIn, token_out: hop.tokenOut, output: '0', limit: leg.minimumReceivedRaw, max_spread_bps: null, max_price: null })) })),
    }] },
  };
  return { data: [quote], meta: { network: 'pubnet', mode: 'exact-in', amount, slippageBps: bps,
    assetIn: { address: input, decimals: 7 }, assetOut: { address: out, decimals: 7 }, quotedAt: new Date().toISOString(), warnings: [], networkFeesIncluded: false } };
}
module.exports = { spotApiFixture, issuer, aggregator };
