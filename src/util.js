export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}]`, ...args);
}

// ECurrencyCode -> ISO 4217. Only the currencies Steam wallets actually use.
export const CURRENCIES = {
  1: 'USD', 2: 'GBP', 3: 'EUR', 4: 'CHF', 5: 'RUB', 6: 'PLN', 7: 'BRL', 8: 'JPY',
  9: 'NOK', 10: 'IDR', 11: 'MYR', 12: 'PHP', 13: 'SGD', 14: 'THB', 15: 'VND',
  16: 'KRW', 17: 'TRY', 18: 'UAH', 19: 'MXN', 20: 'CAD', 21: 'AUD', 22: 'NZD',
  23: 'CNY', 24: 'INR', 25: 'CLP', 26: 'PEN', 27: 'COP', 28: 'ZAR', 29: 'HKD',
  30: 'TWD', 31: 'SAR', 32: 'AED', 34: 'ARS', 35: 'ILS', 37: 'KZT', 38: 'KWD',
  39: 'QAR', 40: 'CRC', 41: 'UYU',
};

export function currencyCode(id) {
  return CURRENCIES[id] || `#${id}`;
}

/** Format an amount in minor units (cents/kopecks) for humans. */
export function money(minor, currency) {
  const code = typeof currency === 'number' ? currencyCode(currency) : currency || '';
  return `${(minor / 100).toFixed(2)} ${code}`.trim();
}

export async function retry(fn, { tries = 4, baseDelay = 2000, label = 'request' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.fatal || i === tries - 1) break;
      const delay = baseDelay * 2 ** i;
      log(`${label} не удался (${err.message}), повтор через ${delay / 1000}с`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
