// Buying Mann Co. Supply Crate Keys from the TF2 in-game store (Mann Co. Store).
import { config } from './config.js';
import { Msg } from './gc.js';
import { currencyCode, log, money, sleep } from './util.js';

export const KEY_DEFINDEX = 5021; // Mann Co. Supply Crate Key

// EPurchaseResult from the TF2 GC.
const PURCHASE_RESULT = {
  1: 'OK', 2: 'Fail', 3: 'InvalidParam', 4: 'InternalError', 5: 'NotApproved',
  6: 'AlreadyCommitted', 7: 'UserNotLoggedIn', 8: 'WrongCurrency', 9: 'AccountError',
  10: 'InsufficientFunds', 11: 'TimedOut', 12: 'AcctDisabled', 13: 'AcctCannotPurchase',
};
const resultName = (r) => `${PURCHASE_RESULT[r] || 'Unknown'} (${r})`;

/**
 * Store price of one key in the wallet currency, in minor units.
 * KEY_STORE_PRICE wins; otherwise ISteamEconomy/GetAssetPrices is queried with STEAM_API_KEY.
 */
export async function getKeyStorePrice(currency) {
  if (config.keyStorePrice > 0) return config.keyStorePrice;
  if (!config.apiKey) {
    throw new Error('Укажите KEY_STORE_PRICE (цена ключа в магазине TF2 в копейках/центах) или STEAM_API_KEY в .env');
  }
  const code = currencyCode(currency);
  const url = `https://api.steampowered.com/ISteamEconomy/GetAssetPrices/v1/?appid=440&currency=${code}&key=${config.apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GetAssetPrices: HTTP ${res.status}`);
  const data = await res.json();
  const asset = data?.result?.assets?.find((a) => String(a.name) === String(KEY_DEFINDEX));
  const price = asset?.prices?.[code];
  if (!price) throw new Error(`GetAssetPrices не вернул цену ключа в ${code}; задайте KEY_STORE_PRICE вручную`);
  return Number(price);
}

/**
 * Approves the Steam micro-transaction the GC created, the same way the Steam
 * overlay does: via the store "approvetxn" page, using our web session.
 */
async function approveTransaction(web, txnId, url) {
  const pageUrl = url || `https://store.steampowered.com/checkout/approvetxn/${txnId}/?returnurl=https%3A%2F%2Fstore.steampowered.com%2F`;
  const page = await web.get(pageUrl, { json: false });
  const html = page.data;
  if (/login\/home|g_steamID = false/.test(html)) {
    throw new Error('Веб-сессия магазина не авторизована');
  }
  // Pick up any hidden fields the page ships so we post exactly what it would.
  const hidden = {};
  for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    const value = m[0].match(/value="([^"]*)"/)?.[1] ?? '';
    if (name) hidden[name] = value;
  }
  const { data } = await web.post('https://store.steampowered.com/checkout/approvetxnsubmit', {
    ...hidden,
    transid: txnId,
    approved: 1,
  }, { referer: pageUrl });
  if (data && data.success !== undefined && Number(data.success) !== 1 && data.success !== true) {
    throw new Error(`approvetxnsubmit отклонён: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function finalize(gc, txnId) {
  const res = await gc.request(
    Msg.StorePurchaseFinalize, 'CMsgGCStorePurchaseFinalize', { txn_id: txnId },
    Msg.StorePurchaseFinalizeResponse, 'CMsgGCStorePurchaseFinalizeResponse',
  );
  return res;
}

async function cancel(gc, txnId) {
  try {
    await gc.request(
      Msg.StorePurchaseCancel, 'CMsgGCStorePurchaseCancel', { txn_id: txnId },
      Msg.StorePurchaseCancelResponse, 'CMsgGCStorePurchaseCancelResponse', 15_000,
    );
    log(`Транзакция ${txnId} отменена`);
  } catch (err) {
    log(`Не удалось отменить транзакцию ${txnId}: ${err.message}`);
  }
}

/**
 * Buys `quantity` keys. Returns { txnId, itemIds, unitPrice, total }.
 */
export async function buyKeys(ctx, gc, quantity, unitPrice) {
  const { currency } = ctx.wallet;
  const total = unitPrice * quantity;
  log(`Покупка ${quantity} ключ(ей) по ${money(unitPrice, currency)} = ${money(total, currency)}`);

  const init = await gc.request(
    Msg.StorePurchaseInit, 'CMsgGCStorePurchaseInit',
    {
      country: ctx.country,
      language: 0,
      currency,
      line_items: [{ item_def_id: KEY_DEFINDEX, quantity, cost_in_local_currency: unitPrice, purchase_type: 0 }],
    },
    Msg.StorePurchaseInitResponse, 'CMsgGCStorePurchaseInitResponse',
  );
  if (init.result !== 1) {
    let hint = '';
    if (init.result === 3 || init.result === 8) hint = ' — проверьте KEY_STORE_PRICE и валюту кошелька';
    if (init.result === 10) hint = ' — недостаточно средств в кошельке';
    throw new Error(`GC отклонил покупку: ${resultName(init.result)}${hint}`);
  }
  const txnId = init.txn_id;
  log(`Транзакция создана: ${txnId}`);

  let approved = false;
  try {
    await approveTransaction(ctx.web, txnId, init.url);
    approved = true;
    log('Транзакция подтверждена через веб-сессию');
  } catch (err) {
    log(`Автоподтверждение не удалось: ${err.message}`);
  }

  const approveUrl = init.url || `https://store.steampowered.com/checkout/approvetxn/${txnId}/`;
  const deadline = Date.now() + (approved ? 60_000 : config.manualApproveWaitMinutes * 60_000);
  if (!approved) log(`Подтвердите покупку вручную: ${approveUrl} (жду ${config.manualApproveWaitMinutes} мин)`);

  while (Date.now() < deadline) {
    const res = await finalize(gc, txnId);
    if (res.result === 1) {
      log(`Покупка завершена, получено предметов: ${res.item_ids.length}`);
      return { txnId, itemIds: res.item_ids, unitPrice, total, currency };
    }
    if (res.result !== 5) {
      await cancel(gc, txnId);
      throw new Error(`Не удалось завершить покупку: ${resultName(res.result)}`);
    }
    await sleep(5000); // NotApproved yet
  }
  await cancel(gc, txnId);
  throw new Error('Транзакция так и не была подтверждена');
}
