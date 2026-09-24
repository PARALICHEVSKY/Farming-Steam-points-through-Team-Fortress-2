import fs from 'node:fs';
import path from 'node:path';
import SteamUser from 'steam-user';
import SteamCommunity from 'steamcommunity';
import SteamTotp from 'steam-totp';
import { config, requireCredentials } from './config.js';
import { SteamWeb } from './web.js';
import { log } from './util.js';

const TOKEN_FILE = () => path.join(config.dataDir, 'refresh_token.txt');

function once(emitter, event, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      emitter.removeListener(event, handler);
      reject(new Error(`Таймаут ожидания: ${label || event}`));
    }, timeoutMs);
    function handler(...args) {
      clearTimeout(t);
      resolve(args);
    }
    emitter.once(event, handler);
  });
}

/**
 * Logs into Steam (Steam Guard codes generated from shared_secret) and prepares
 * everything the bot needs: web cookies, wallet info, account country.
 */
export async function login() {
  requireCredentials();
  fs.mkdirSync(config.dataDir, { recursive: true });

  const user = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
  const community = new SteamCommunity();
  const web = new SteamWeb();
  const ctx = { user, community, web, steamID: null, country: 'US', wallet: null };

  user.on('steamGuard', (domain, callback, lastCodeWrong) => {
    if (lastCodeWrong) log('Steam Guard: предыдущий код не подошёл, генерирую новый');
    callback(SteamTotp.generateAuthCode(config.sharedSecret));
  });
  user.on('refreshToken', (token) => fs.writeFileSync(TOKEN_FILE(), token, { mode: 0o600 }));
  user.on('accountInfo', (name, country) => { if (country) ctx.country = country; });
  user.on('wallet', (hasWallet, currency, balance) => {
    ctx.wallet = { hasWallet, currency, balance: Math.round(balance * 100) };
  });
  user.on('webSession', (sessionID, cookies) => {
    web.setCookies(cookies, sessionID);
    community.setCookies(cookies);
  });
  user.on('error', (err) => log('Ошибка Steam:', err.message));
  user.on('disconnected', (eresult, msg) => log('Отключено от Steam:', msg || eresult));

  let details;
  if (fs.existsSync(TOKEN_FILE())) {
    details = { refreshToken: fs.readFileSync(TOKEN_FILE(), 'utf8').trim() };
  } else {
    details = {
      accountName: config.accountName,
      password: config.password,
      twoFactorCode: SteamTotp.generateAuthCode(config.sharedSecret),
    };
  }

  const loggedOn = once(user, 'loggedOn', 60_000, 'вход в Steam');
  const webSession = once(user, 'webSession', 90_000, 'веб-сессия Steam');
  try {
    user.logOn(details);
    await loggedOn;
  } catch (err) {
    if (details.refreshToken) {
      log('Сохранённый токен не подошёл, вход по паролю');
      fs.rmSync(TOKEN_FILE(), { force: true });
      user.logOn({
        accountName: config.accountName,
        password: config.password,
        twoFactorCode: SteamTotp.generateAuthCode(config.sharedSecret),
      });
      await once(user, 'loggedOn', 60_000, 'вход в Steam');
    } else {
      throw err;
    }
  }
  ctx.steamID = user.steamID.getSteamID64();
  log(`Вошли как ${ctx.steamID}`);
  await webSession;

  // The wallet event normally arrives right after logon; give it a moment.
  for (let i = 0; i < 20 && !ctx.wallet; i++) await new Promise((r) => setTimeout(r, 500));
  if (!ctx.wallet) throw new Error('Steam не прислал информацию о кошельке');
  return ctx;
}

export function logout(ctx) {
  try {
    ctx.user.gamesPlayed([]);
    ctx.user.logOff();
  } catch { /* ignore */ }
}
