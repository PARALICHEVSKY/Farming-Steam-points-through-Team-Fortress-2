// Steam Community Market fee math. All amounts are integers in minor units.

export function feesForReceive(receive, { steamFeePercent = 0.05, publisherFeePercent = 0.10, minFee = 1 } = {}) {
  const steamFee = Math.max(minFee, Math.floor(receive * steamFeePercent));
  const publisherFee = Math.max(minFee, Math.floor(receive * publisherFeePercent));
  return { receive, steamFee, publisherFee, buyerPays: receive + steamFee + publisherFee };
}

/**
 * The most the seller can receive so that the buyer pays no more than `buyerPrice`.
 * This is the `price` value the /market/sellitem endpoint expects.
 */
export function receiveForBuyerPrice(buyerPrice, opts) {
  const pct = 1 + (opts?.steamFeePercent ?? 0.05) + (opts?.publisherFeePercent ?? 0.10);
  let r = Math.ceil(buyerPrice / pct) + 2;
  while (r > 0 && feesForReceive(r, opts).buyerPays > buyerPrice) r--;
  return Math.max(0, r);
}

/** Per-key economics of one buy -> sell cycle. */
export function cycleEconomics({ storePrice, buyerPrice, pointsPerUnit = 100, feeOpts }) {
  const receive = receiveForBuyerPrice(buyerPrice, feeOpts);
  const loss = storePrice - receive;
  const points = Math.floor((storePrice / 100) * pointsPerUnit);
  return {
    storePrice,
    buyerPrice,
    receive,
    loss,
    lossPercent: storePrice > 0 ? (loss / storePrice) * 100 : 0,
    points,
    costPer100Points: points > 0 ? (loss / points) * 100 : Infinity,
  };
}
