// Steam Guard mobile confirmations for market listings (identity_secret).
import SteamCommunity from 'steamcommunity';
import SteamTotp from 'steam-totp';
import { config } from './config.js';
import { log, sleep } from './util.js';

const MARKET_LISTING = SteamCommunity.ConfirmationType?.MarketListing ?? 3;

function getConfirmations(community) {
  const time = SteamTotp.time();
  const key = SteamTotp.getConfirmationKey(config.identitySecret, time, 'list');
  return new Promise((resolve, reject) => {
    community.getConfirmations(time, { tag: 'list', key }, (err, confs) => (err ? reject(err) : resolve(confs || [])));
  });
}

function respond(conf) {
  const time = SteamTotp.time();
  const key = SteamTotp.getConfirmationKey(config.identitySecret, time, 'accept');
  return new Promise((resolve, reject) => {
    conf.respond(time, { tag: 'accept', key }, true, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Accepts pending MARKET LISTING confirmations only. Trade confirmations are
 * never touched, so this can't be abused to approve an outgoing trade.
 * Returns the number of accepted confirmations.
 */
export async function acceptMarketConfirmations(community, { attempts = 3 } = {}) {
  if (!config.identitySecret) {
    log('Автоподтверждение выключено (нет maFile). Откройте приложение Steam на телефоне →');
    log('«Подтверждения» и подтвердите лоты на Торговой площадке.');
    return 0;
  }
  let accepted = 0;
  for (let i = 0; i < attempts; i++) {
    const confs = (await getConfirmations(community)).filter((c) => Number(c.type) === MARKET_LISTING);
    if (!confs.length) break;
    for (const c of confs) {
      try {
        await respond(c);
        accepted++;
        log(`Подтверждён лот на ТП: ${c.title || c.id}${c.receiving ? ` (${c.receiving})` : ''}`);
      } catch (err) {
        log(`Не удалось подтвердить ${c.id}: ${err.message}`);
      }
      await sleep(1000);
    }
    await sleep(2000);
  }
  return accepted;
}
