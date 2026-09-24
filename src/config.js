import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function str(name, def = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v.trim();
}

function num(name, def) {
  const v = str(name);
  if (v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

function bool(name, def) {
  const v = str(name).toLowerCase();
  if (v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

export const config = {
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

export function requireCredentials() {
  const missing = ['STEAM_ACCOUNT_NAME', 'STEAM_PASSWORD', 'STEAM_SHARED_SECRET', 'STEAM_IDENTITY_SECRET']
    .filter((k) => !str(k));
  if (missing.length) {
    throw new Error(`Не заданы переменные в .env: ${missing.join(', ')} (см. .env.example)`);
  }
}
