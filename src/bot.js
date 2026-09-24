// The buy -> sell cycle.
import { config } from './config.js';
import { acceptMarketConfirmations } from './confirm.js';
import { cycleEconomics } from './fees.js';
import { getInventoryKeys, getMarketPrice, sellKey, targetBuyerPrice, feeOpts } from './market.js';
import { recordListing, recordPurchase, spentToday, unsoldPurchasedAssets } from './ledger.js';
import { buyKeys, getKeyStorePrice } from './store.js';
import { log, money, sleep } from './util.js';

/** Current store price, market price and the resulting loss per key. */
export async function quote(ctx) {
  const { currency } = ctx.wallet;
  const storePrice = await getKeyStorePrice(currency);
  const market = await getMarketPrice(ctx.web, currency, ctx.country);
  const buyerPrice = targetBuyerPrice(market.lowestSell);
  const econ = cycleEconomics({ storePrice, buyerPrice, pointsPerUnit: config.pointsPerUnit, feeOpts: feeOpts() });
  return { currency, market, ...econ };
}

export function printQuote(q) {
  const m = (v) => money(v, q.currency);
  log(`Магазин TF2: ${m(q.storePrice)} | ТП мин. цена продажи: ${m(q.market.lowestSell)}`
    + ` | макс. заявка на покупку: ${m(q.market.highestBuy)}`);
  log(`Выставим за ${m(q.buyerPrice)} -> получим ${m(q.receive)} | убыток ${m(q.loss)}`
    + ` (${q.lossPercent.toFixed(1)}%) | ~${q.points} очков | ${m(Math.round(q.costPer100Points))} за 100 очков`);
}

/** Checks the safety limits. Returns a reason string if the cycle must be skipped. */
function guard(q, keys, wallet) {
  if (q.lossPercent > config.maxLossPercent) {
    return `убыток ${q.lossPercent.toFixed(1)}% больше MAX_LOSS_PERCENT=${config.maxLossPercent}%`;
  }
  if (config.minBuyerPrice && q.buyerPrice < config.minBuyerPrice) {
    return `цена на ТП ниже MIN_BUYER_PRICE=${config.minBuyerPrice}`;
  }
  const total = q.storePrice * keys;
  if (wallet.balance < total) {
    return `в кошельке ${money(wallet.balance, q.currency)}, нужно ${money(total, q.currency)}`;
  }
  if (config.dailySpendLimit && spentToday() + total > config.dailySpendLimit) {
    return `превышен DAILY_SPEND_LIMIT (${money(config.dailySpendLimit, q.currency)} в сутки)`;
  }
  return null;
}

/** Polls the inventory until the given assets are present and marketable. */
async function waitForMarketable(ctx, itemIds) {
  const want = new Set(itemIds.map(String));
  const deadline = Date.now() + config.inventoryWaitMinutes * 60_000;
  while (Date.now() < deadline) {
    const keys = await getInventoryKeys(ctx.web, ctx.steamID);
    const ready = keys.filter((k) => want.has(k.assetid) && k.marketable).length;
    if (ready === want.size) return true;
    log(`Жду ключи в инвентаре: готово к продаже ${ready}/${want.size}`);
    await sleep(30_000);
  }
  log('Не все ключи стали доступны для продажи вовремя — продайте позже командой `sell`');
  return false;
}

export async function buy(ctx, gc, keys) {
  const q = await quote(ctx);
  printQuote(q);
  const reason = guard(q, keys, ctx.wallet);
  if (reason) {
    log(`Покупка пропущена: ${reason}`);
    return null;
  }
  if (config.dryRun) {
    log(`[DRY_RUN] Купил бы ${keys} ключ(ей) за ${money(q.storePrice * keys, q.currency)}`);
    return null;
  }
  const purchase = await buyKeys(ctx, gc, keys, q.storePrice);
  recordPurchase(purchase);
  return purchase;
}

/** Lists every sellable key at the current lowest ask and confirms the listings. */
export async function sell(ctx) {
  const inventory = await getInventoryKeys(ctx.web, ctx.steamID);
  const marketable = new Set(inventory.filter((k) => k.marketable).map((k) => k.assetid));
  let candidates;
  if (config.sellOnlyPurchased) {
    candidates = unsoldPurchasedAssets().filter((a) => marketable.has(a.assetid));
  } else {
    const storePrice = await getKeyStorePrice(ctx.wallet.currency);
    candidates = [...marketable].map((assetid) => ({ assetid, storePrice }));
  }
  if (!candidates.length) {
    log('Нет ключей, готовых к продаже');
    return 0;
  }

  let listed = 0;
  let q = null;
  for (const [i, c] of candidates.entries()) {
    if (i % 5 === 0) q = await quote(ctx); // refresh the lowest ask every few listings
    const { buyerPrice } = q;
    if (config.minBuyerPrice && buyerPrice < config.minBuyerPrice) {
      log(`Цена ${money(buyerPrice, q.currency)} ниже MIN_BUYER_PRICE, продажа остановлена`);
      break;
    }
    if (config.dryRun) {
      log(`[DRY_RUN] Выставил бы ключ ${c.assetid} за ${money(buyerPrice, q.currency)}`);
      continue;
    }
    try {
      const { receive } = await sellKey(ctx, c.assetid, buyerPrice);
      recordListing({ assetid: c.assetid, buyerPrice, receive, storePrice: c.storePrice, currency: q.currency });
      listed++;
    } catch (err) {
      log(err.message);
      if (err.fatal) break;
    }
    await sleep(3000);
  }

  if (listed && !config.dryRun) {
    await sleep(3000);
    const n = await acceptMarketConfirmations(ctx.community);
    log(`Подтверждено лотов: ${n}/${listed}`);
  }
  return listed;
}

export async function run(ctx, gc, { cycles, keys }) {
  for (let i = 1; i <= cycles; i++) {
    log(`===== Цикл ${i}/${cycles} =====`);
    try {
      const purchase = await buy(ctx, gc, keys);
      if (purchase) await waitForMarketable(ctx, purchase.itemIds);
      await sell(ctx);
    } catch (err) {
      log(`Цикл ${i} завершился с ошибкой: ${err.message}`);
    }
    if (i < cycles) await sleep(config.cycleDelaySeconds * 1000);
  }
}
