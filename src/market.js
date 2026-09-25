// Steam Community Market: price lookup, inventory, listing keys for sale.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { receiveForBuyerPrice } from './fees.js';
import { log, retry } from './util.js';

export const KEY_NAME = 'Mann Co. Supply Crate Key';
const LISTING_URL = `https://steamcommunity.com/market/listings/440/${encodeURIComponent(KEY_NAME)}`;

export const feeOpts = () => ({
  steamFeePercent: config.steamFeePercent,
  publisherFeePercent: config.publisherFeePercent,
});

async function getItemNameId(web) {
  const cache = path.join(config.dataDir, 'item_nameid.txt');
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8').trim();
  const { data } = await retry(() => web.get(LISTING_URL, { json: false }), { label: 'страница ключа на ТП' });
  const id = data.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/)?.[1];
  if (!id) throw new Error('Не удалось найти item_nameid ключа на странице ТП');
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(cache, id);
  return id;
}

/** Current order book top for the key, minor units of `currency`. */
export async function getMarketPrice(web, currency, country = 'US') {
  const nameId = await getItemNameId(web);
  const url = `https://steamcommunity.com/market/itemordershistogram?country=${country}&language=english`
    + `&currency=${currency}&item_nameid=${nameId}&two_factor=0`;
  const { data } = await retry(() => web.get(url, { referer: LISTING_URL }), { label: 'цены ТП' });
  if (!data || Number(data.success) !== 1) throw new Error('itemordershistogram вернул ошибку');
  const lowestSell = Number(data.lowest_sell_order) || 0;
  const highestBuy = Number(data.highest_buy_order) || 0;
  if (!lowestSell) throw new Error('На ТП нет лотов на продажу ключа');
  return { lowestSell, highestBuy };
}

/** Buyer price we list at: lowest ask minus the configured undercut. */
export function targetBuyerPrice(lowestSell) {
  return Math.max(1, lowestSell - config.undercut);
}

/** Marketable keys in the TF2 inventory: [{ assetid, marketable }]. */
export async function getInventoryKeys(web, steamID) {
  const url = `https://steamcommunity.com/inventory/${steamID}/440/2?l=english&count=2000`;
  const { data } = await retry(() => web.get(url), { label: 'инвентарь' });
  if (!data || !data.assets) return [];
  const desc = new Map((data.descriptions || []).map((d) => [`${d.classid}_${d.instanceid}`, d]));
  return data.assets
    .map((a) => ({ a, d: desc.get(`${a.classid}_${a.instanceid}`) }))
    .filter(({ d }) => d && d.market_hash_name === KEY_NAME)
    .map(({ a, d }) => ({ assetid: String(a.assetid), marketable: Number(d.marketable) === 1 }));
}

/**
 * Lists one key. `buyerPrice` is what the buyer will see; Steam wants the
 * amount the seller receives after fees.
 */
export async function sellKey(ctx, assetid, buyerPrice) {
  const receive = receiveForBuyerPrice(buyerPrice, feeOpts());
  const { data } = await ctx.web.post('https://steamcommunity.com/market/sellitem/', {
    appid: 440,
    contextid: 2,
    assetid,
    amount: 1,
    price: receive,
  }, { referer: `https://steamcommunity.com/profiles/${ctx.steamID}/inventory/` });
  if (!data || !data.success) {
    const err = new Error(`Steam отклонил лот ${assetid}: ${data?.message || 'неизвестная ошибка'}`);
    err.fatal = true;
    throw err;
  }
  log(`Выставлен ключ ${assetid}: покупатель платит ${buyerPrice}, мы получим ${receive}`
    + (data.needs_mobile_confirmation ? ' (нужно подтверждение)' : ''));
  return { receive, needsConfirmation: Boolean(data.requires_confirmation || data.needs_mobile_confirmation) };
}
