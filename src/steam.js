import fs from 'node:fs';
import path from 'node:path';
import SteamUser from 'steam-user';
import SteamCommunity from 'steamcommunity';
import SteamTotp from 'steam-totp';
import { config, requireCredentials } from './config.js';
import { SteamWeb } from './web.js';
import { ask } from './prompt.js';
import { log } from './util.js';

const TOKEN_FILE = () => path.join(config.dataDir, 'refresh_token.txt');

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

  user.on('steamGuard', async (domain, callback, lastCodeWrong) => {
    if (config.sharedSecret) {
      if (lastCodeWrong) log('Steam Guard: предыдущий код не подошёл, генерирую новый');
      callback(SteamTotp.generateAuthCode(config.sharedSecret));
      return;
    }
    if (lastCodeWrong) console.log('Код не подошёл, попробуйте ещё раз.');
    const where = domain ? `из письма на почту ${domain}` : 'из приложения Steam на телефоне (Steam Guard)';
    callback(await ask(`Введите код ${where}`));
  });
  user.on('refreshToken', (token) => fs.writeFileSync(TOKEN_FILE(), token, { mode: 0o600 }));
  user.on('accountInfo', (name, country) => { if (country) ctx.country = country; });
  user.on('wallet', (hasWallet, currency, balance) => {
    ctx.wallet = { hasWallet, currency, balance: Math.round(balance * 100) };
  });
  let webReady;
  const webSession = new Promise((resolve) => { webReady = resolve; });
  user.on('webSession', (sessionID, cookies) => {
    web.setCookies(cookies, sessionID);
    community.setCookies(cookies);
    webReady();
  });
  // Login errors are reported by login() itself; this is for errors after we're in.
  user.on('error', (err) => { if (ctx.steamID) log('Ошибка Steam:', err.message); });
  user.on('disconnected', (eresult, msg) => log('Отключено от Steam:', msg || eresult));

  const passwordDetails = () => ({
    accountName: config.accountName,
    password: config.password,
    ...(config.sharedSecret ? { twoFactorCode: SteamTotp.generateAuthCode(config.sharedSecret) } : {}),
  });
  const details = fs.existsSync(TOKEN_FILE())
    ? { refreshToken: fs.readFileSync(TOKEN_FILE(), 'utf8').trim() }
    : passwordDetails();

  log('Вход в Steam...');
  try {
    await logOnOnce(user, details);
  } catch (err) {
    if (!details.refreshToken) throw friendlyLoginError(err);
    log('Сохранённый вход устарел, вхожу по паролю');
    fs.rmSync(TOKEN_FILE(), { force: true });
    try {
      await logOnOnce(user, passwordDetails());
    } catch (err2) {
      throw friendlyLoginError(err2);
    }
  }
  ctx.steamID = user.steamID.getSteamID64();
  log(`Вошли как ${ctx.steamID}`);
  await Promise.race([
    webSession,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Steam не выдал веб-сессию, попробуйте позже')), 90_000).unref()),
  ]);

  // The wallet event normally arrives right after logon; give it a moment.
  for (let i = 0; i < 20 && !ctx.wallet; i++) await new Promise((r) => setTimeout(r, 500));
  if (!ctx.wallet) throw new Error('Steam не прислал информацию о кошельке');
  return ctx;
}

// steam-user reports login failures through the 'error' event.
function logOnOnce(user, details) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { user.removeListener('loggedOn', ok); user.removeListener('error', fail); };
    const ok = () => { cleanup(); resolve(); };
    const fail = (err) => { cleanup(); reject(err); };
    user.once('loggedOn', ok);
    user.once('error', fail);
    user.logOn(details);
  });
}

function friendlyLoginError(err) {
  const R = SteamUser.EResult;
  const messages = {
    [R.InvalidPassword]: 'Неверный логин или пароль. Проверьте их в «Настройках».',
    [R.RateLimitExceeded]: 'Steam временно заблокировал вход из-за частых попыток. Подождите 30–60 минут.',
    [R.AccountLoginDeniedThrottle]: 'Steam временно заблокировал вход из-за частых попыток. Подождите 30–60 минут.',
    [R.TwoFactorCodeMismatch]: 'Неверный код Steam Guard. Если используете maFile — проверьте, что он от этого аккаунта и часы на ПК точные.',
    [R.InvalidLoginAuthCode]: 'Неверный код Steam Guard из письма.',
    [R.AccountDisabled]: 'Аккаунт заблокирован Steam.',
  };
  const msg = messages[err.eresult];
  return msg ? new Error(msg) : err;
}

export function logout(ctx) {
  try {
    ctx.user.gamesPlayed([]);
    ctx.user.logOff();
  } catch { /* ignore */ }
}
