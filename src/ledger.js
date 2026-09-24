// Local JSON ledger: every purchase and every listing, so the loss per key is tracked.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = () => path.join(config.dataDir, 'ledger.json');

export function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch {
    return { purchases: [], listings: [] };
  }
}

function save(ledger) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, FILE());
}

export function recordPurchase({ txnId, itemIds, unitPrice, currency, dryRun = false }) {
  const ledger = loadLedger();
  ledger.purchases.push({
    at: new Date().toISOString(), txnId, itemIds, unitPrice, currency, dryRun,
  });
  save(ledger);
}

export function recordListing({ assetid, buyerPrice, receive, storePrice, currency, dryRun = false }) {
  const ledger = loadLedger();
  ledger.listings.push({
    at: new Date().toISOString(), assetid, buyerPrice, receive, storePrice, loss: storePrice - receive, currency, dryRun,
  });
  save(ledger);
}

/** Asset IDs bought by the bot that have not been listed yet. */
export function unsoldPurchasedAssets(ledger = loadLedger()) {
  const listed = new Set(ledger.listings.filter((l) => !l.dryRun).map((l) => String(l.assetid)));
  const out = [];
  for (const p of ledger.purchases) {
    if (p.dryRun) continue;
    for (const id of p.itemIds) if (!listed.has(String(id))) out.push({ assetid: String(id), storePrice: p.unitPrice });
  }
  return out;
}

export function spentToday(ledger = loadLedger()) {
  const day = new Date().toISOString().slice(0, 10);
  return ledger.purchases
    .filter((p) => !p.dryRun && p.at.startsWith(day))
    .reduce((s, p) => s + p.unitPrice * p.itemIds.length, 0);
}

export function stats(ledger = loadLedger()) {
  const purchases = ledger.purchases.filter((p) => !p.dryRun);
  const listings = ledger.listings.filter((l) => !l.dryRun);
  const keysBought = purchases.reduce((s, p) => s + p.itemIds.length, 0);
  const spent = purchases.reduce((s, p) => s + p.unitPrice * p.itemIds.length, 0);
  const expectedProceeds = listings.reduce((s, l) => s + l.receive, 0);
  const listedLoss = listings.reduce((s, l) => s + l.loss, 0);
  const points = Math.floor((spent / 100) * config.pointsPerUnit);
  const listedPoints = Math.floor((listings.reduce((s, l) => s + l.storePrice, 0) / 100) * config.pointsPerUnit);
  return {
    currency: purchases[0]?.currency ?? listings[0]?.currency ?? null,
    keysBought,
    keysListed: listings.length,
    keysPending: unsoldPurchasedAssets(ledger).length,
    spent,
    expectedProceeds,
    listedLoss,
    avgLossPerKey: listings.length ? Math.round(listedLoss / listings.length) : 0,
    pointsEstimate: points,
    costPer100Points: listedPoints ? Math.round((listedLoss / listedPoints) * 100) : 0,
    recent: [...ledger.listings].reverse().slice(0, 50),
  };
}
