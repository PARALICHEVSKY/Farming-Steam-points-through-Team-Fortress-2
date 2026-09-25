// Step-by-step setup wizard. Writes .env so nobody has to edit it by hand.
import fs from 'node:fs';
import path from 'node:path';
import { config, ENV_EXAMPLE, ENV_FILE, reloadConfig } from './config.js';
import { ask, askHidden, parsePrice } from './prompt.js';

function quote(value) {
  const v = String(value);
  if (v === '' || /^[\w.@+/=-]+$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"')) return `"${v}"`;
  return `\`${v}\``;
}

/** Writes values into .env, keeping the comments and defaults from .env.example. */
export function writeEnv(values) {
  const template = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : fs.readFileSync(ENV_EXAMPLE, 'utf8');
  const seen = new Set();
  const lines = template.split(/\r?\n/).map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (!m || !(m[1] in values)) return line;
    seen.add(m[1]);
    return `${m[1]}=${quote(values[m[1]])}`;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) lines.push(`${k}=${quote(v)}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
}

/** Reads shared_secret / identity_secret from a Steam Desktop Authenticator .maFile. */
function readMaFile(raw) {
  const file = raw.trim().replace(/^["'&\s]+|["'\s]+$/g, ''); // drag & drop adds quotes
  if (!fs.existsSync(file)) return { error: `Файл не найден: ${file}` };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {
      error: 'Файл не читается. Скорее всего, в SDA включено шифрование. '
        + 'Откройте SDA → Manage Encryption → снимите пароль, и попробуйте снова.',
    };
  }
  if (!data.shared_secret || !data.identity_secret) return { error: 'В файле нет shared_secret / identity_secret' };
  return { sharedSecret: data.shared_secret, identitySecret: data.identity_secret, accountName: data.account_name };
}

const line = () => console.log('─'.repeat(60));

export async function runSetup() {
  console.clear();
  line();
  console.log(' НАСТРОЙКА (нужно сделать один раз)');
  line();
  console.log(' Данные сохраняются только на этом компьютере, в файле .env.');
  console.log(' Никуда, кроме самого Steam, они не отправляются.');
  console.log(' Никому не передавайте файл .env и папку data!\n');

  const values = {};

  // 1. Login
  console.log('ШАГ 1 из 4. Логин Steam');
  console.log('  Это имя, которое вы вводите при входе в Steam (НЕ ник в профиле).');
  for (;;) {
    values.STEAM_ACCOUNT_NAME = await ask('  Логин', config.accountName);
    if (values.STEAM_ACCOUNT_NAME) break;
    console.log('  Логин не может быть пустым.');
  }

  // 2. Password
  console.log('\nШАГ 2 из 4. Пароль Steam');
  console.log('  Вместо букв будут звёздочки *, это нормально. Введите пароль и нажмите Enter.');
  for (;;) {
    const hint = config.password ? ' (Enter = оставить прежний)' : '';
    const p = await askHidden(`  Пароль${hint}`);
    values.STEAM_PASSWORD = p || config.password;
    if (values.STEAM_PASSWORD) break;
    console.log('  Пароль не может быть пустым.');
  }

  // 3. Steam Guard
  console.log('\nШАГ 3 из 4. Steam Guard');
  console.log('  Как у вас подключён Steam Guard?');
  console.log('   1 — Обычное приложение Steam на телефоне (так у большинства)');
  console.log('       → при входе спрошу код из приложения, лоты на ТП подтвердите в телефоне');
  console.log('   2 — Есть файл .maFile от Steam Desktop Authenticator');
  console.log('       → всё будет полностью автоматически, без телефона');
  const hadSecrets = Boolean(config.sharedSecret && config.identitySecret);
  const guard = await ask('  Введите 1 или 2', hadSecrets ? '2' : '1');
  if (guard === '2') {
    if (hadSecrets) console.log('  (Enter = оставить уже сохранённый maFile)');
    for (;;) {
      const raw = await ask('  Перетащите файл .maFile в это окно мышкой и нажмите Enter');
      if (!raw && hadSecrets) {
        values.STEAM_SHARED_SECRET = config.sharedSecret;
        values.STEAM_IDENTITY_SECRET = config.identitySecret;
        break;
      }
      const res = readMaFile(raw);
      if (res.error) {
        console.log(`  ✗ ${res.error}`);
        continue;
      }
      if (res.accountName && res.accountName.toLowerCase() !== values.STEAM_ACCOUNT_NAME.toLowerCase()) {
        console.log(`  ⚠ Этот maFile от аккаунта «${res.accountName}», а логин «${values.STEAM_ACCOUNT_NAME}».`);
        if ((await ask('  Всё равно использовать? (да/нет)', 'нет')).toLowerCase() !== 'да') continue;
      }
      values.STEAM_SHARED_SECRET = res.sharedSecret;
      values.STEAM_IDENTITY_SECRET = res.identitySecret;
      console.log('  ✓ maFile прочитан');
      break;
    }
  } else {
    values.STEAM_SHARED_SECRET = '';
    values.STEAM_IDENTITY_SECRET = '';
  }

  // 4. Key price
  console.log('\nШАГ 4 из 4. Цена ключа в магазине TF2');
  console.log('  Запустите TF2 → «Магазин Манн Ко.» → найдите «Ключ от ящика Манн Ко.»');
  console.log('  и введите цену так, как она там написана (например 2.49 или 185).');
  console.log('  Не знаете — нажмите Enter, спрошу позже.');
  const oldPrice = config.keyStorePrice ? (config.keyStorePrice / 100).toFixed(2) : '';
  for (;;) {
    const raw = await ask('  Цена ключа', oldPrice);
    if (!raw) {
      values.KEY_STORE_PRICE = '';
      break;
    }
    const minor = parsePrice(raw);
    if (minor) {
      values.KEY_STORE_PRICE = minor;
      break;
    }
    console.log('  Не понял цену. Введите число, например 2.49');
  }

  // A different account must not reuse the old saved login token.
  if (config.accountName && config.accountName !== values.STEAM_ACCOUNT_NAME) {
    fs.rmSync(path.join(config.dataDir, 'refresh_token.txt'), { force: true });
  }

  writeEnv(values);
  reloadConfig();
  console.log('\n✓ Настройки сохранены!');
  console.log('  Остальные параметры (лимиты, задержки) можно поменять в файле .env,');
  console.log('  но для начала они уже настроены безопасно.\n');
}

/** Asks for the store key price if it's still unknown and saves it. */
export async function ensureKeyPrice() {
  if (config.keyStorePrice > 0 || config.apiKey) return;
  console.log('\nНужна цена ключа в магазине TF2.');
  console.log('Запустите TF2 → «Магазин Манн Ко.» → «Ключ от ящика Манн Ко.» и введите цену (например 2.49).');
  for (;;) {
    const minor = parsePrice(await ask('Цена ключа'));
    if (minor) {
      writeEnv({ KEY_STORE_PRICE: minor });
      reloadConfig();
      return;
    }
    console.log('Не понял цену. Введите число, например 2.49');
  }
}
