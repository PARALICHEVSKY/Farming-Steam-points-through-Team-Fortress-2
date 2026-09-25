import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, '.env');
export const ENV_EXAMPLE = path.join(ROOT, '.env.example');

function load(env) {
  const str = (name, def = '') => {
    const v = env[name];
    return v === undefined || v === '' ? def : String(v).trim();
  };
  const num = (name, def) => {
    const v = str(name);
    if (v === '') return def;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} в .env должно быть числом, а там "${v}"`);
    return n;
  };
  const bool = (name, def) => {
    const v = str(name).toLowerCase();
    if (v === '') return def;
    return ['1', 'true', 'yes', 'on', 'да'].includes(v);
  };

  return {
    rootDir: ROOT,
    dataDir: path.join(ROOT, 'data'),

    accountName: str('STEAM_ACCOUNT_NAME'),
    password: str('STEAM_PASSWORD'),
    sharedSecret: str('STEAM_SHARED_SECRET'),
    identitySecret: str('STEAM_IDENTITY_SECRET'),
    apiKey: str('STEAM_API_KEY'),

    dryRun: bool('DRY_RUN', true),
    keysPerCycle: num('KEYS_PER_CYCLE', 1),
    cycles: num('CYCLES', 1),
    maxLossPercent: num('MAX_LOSS_PERCENT', 25),
    dailySpendLimit: num('DAILY_SPEND_LIMIT', 0),
    minBuyerPrice: num('MIN_BUYER_PRICE', 0),
    sellOnlyPurchased: bool('SELL_ONLY_PURCHASED', true),

    keyStorePrice: num('KEY_STORE_PRICE', 0),
    undercut: num('UNDERCUT', 0),
    steamFeePercent: num('STEAM_FEE_PERCENT', 0.05),
    publisherFeePercent: num('PUBLISHER_FEE_PERCENT', 0.10),
    pointsPerUnit: num('POINTS_PER_UNIT', 100),

    inventoryWaitMinutes: num('INVENTORY_WAIT_MINUTES', 10),
    cycleDelaySeconds: num('CYCLE_DELAY_SECONDS', 60),
    manualApproveWaitMinutes: num('MANUAL_APPROVE_WAIT_MINUTES', 5),

    dashboardPort: num('DASHBOARD_PORT', 3000),
  };
}

function readEnvFile() {
  try {
    return dotenv.parse(fs.readFileSync(ENV_FILE));
  } catch {
    return {};
  }
}

export const config = load({ ...readEnvFile(), ...process.env });

/** Re-reads .env after the setup wizard rewrote it. The file wins over the old process env. */
export function reloadConfig() {
  Object.assign(config, load({ ...process.env, ...readEnvFile() }));
}

export function hasEnvFile() {
  return fs.existsSync(ENV_FILE);
}

export function requireCredentials() {
  if (!config.accountName || !config.password) {
    throw new Error('Не указан логин или пароль Steam. Запустите настройку заново (пункт «Настройки» в меню).');
  }
}
