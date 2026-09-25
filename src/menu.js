// Simple numbered menu for people who don't want to touch the command line.
import { config, hasEnvFile } from './config.js';
import { printQuote, quote, run, sell } from './bot.js';
import { acceptMarketConfirmations } from './confirm.js';
import { startDashboard } from './dashboard.js';
import { TF2GC } from './gc.js';
import { printStats } from './ledger.js';
import { ask, askNumber, confirm, pause } from './prompt.js';
import { ensureKeyPrice, runSetup } from './setup.js';
import { login, logout } from './steam.js';
import { money } from './util.js';

const line = () => console.log('─'.repeat(60));

export async function menu() {
  if (!hasEnvFile() || !config.accountName) await runSetup();

  let ctx = null;
  let gc = null;
  let dashboard = null;

  const session = async () => {
    if (!ctx) ctx = await login();
    return ctx;
  };
  const tf2 = async () => {
    await session();
    if (!gc) {
      console.log('Подключаюсь к TF2 (игру запускать не нужно)...');
      gc = new TF2GC(ctx.user);
      await gc.connect();
    }
    return gc;
  };
  const closeSession = () => {
    if (ctx) logout(ctx);
    ctx = null;
    gc = null;
  };

  const actions = {
    // Check prices: spends nothing.
    1: async () => {
      await ensureKeyPrice();
      await session();
      printQuote(await quote(ctx));
      console.log('  Это только расчёт, ничего не куплено.');
    },

    // Trial run: the full cycle but nothing is bought or listed.
    2: async () => {
      await ensureKeyPrice();
      await tf2();
      console.log('\nПробный запуск: покажу, что сделал бы бот. Деньги НЕ тратятся.\n');
      config.dryRun = true;
      await run(ctx, gc, { cycles: 1, keys: 1 });
    },

    // Real farming.
    3: async () => {
      await ensureKeyPrice();
      await tf2();
      const keys = await askNumber('Сколько ключей покупать за один раз', config.keysPerCycle, { max: 50 });
      const cycles = await askNumber('Сколько раз повторить', config.cycles, { max: 100 });
      const q = await quote(ctx);
      printQuote(q);
      const m = (v) => money(v, q.currency);
      const total = q.storePrice * keys;
      line();
      console.log(`  За один раз будет потрачено:   ${m(total)} (в кошельке ${m(ctx.wallet.balance)})`);
      console.log(`  Потеря за один раз:            ~${m(q.loss * keys)}`);
      console.log(`  Очков Steam за один раз:       ~${q.points * keys}`);
      if (cycles > 1) {
        console.log('\n  Учтите: деньги за ключи вернутся на кошелёк, только когда их кто-то купит.');
        console.log('  Если денег на следующий круг не хватит, бот его пропустит.');
      }
      line();
      if (!await confirm('Покупаем за реальные деньги?')) {
        console.log('Отменено, ничего не куплено.');
        return;
      }
      config.dryRun = false;
      try {
        await run(ctx, gc, { cycles, keys });
      } finally {
        config.dryRun = true;
      }
      printStats();
    },

    // Sell keys bought earlier.
    4: async () => {
      await ensureKeyPrice();
      await session();
      if (!await confirm('Выставить купленные ботом ключи на ТП по самой низкой цене?')) return;
      config.dryRun = false;
      try {
        await sell(ctx);
      } finally {
        config.dryRun = true;
      }
    },

    5: async () => {
      await session();
      const n = await acceptMarketConfirmations(ctx.community);
      if (config.identitySecret) console.log(`Подтверждено лотов: ${n}`);
    },

    6: async () => printStats(),

    7: async () => {
      if (!dashboard) dashboard = startDashboard();
      console.log(`Откройте в браузере: http://localhost:${config.dashboardPort}`);
      console.log('Страница работает, пока открыто это окно.');
    },

    8: async () => {
      closeSession();
      await runSetup();
    },
  };

  for (;;) {
    console.log('');
    line();
    console.log(' ФАРМ ОЧКОВ STEAM ЧЕРЕЗ КЛЮЧИ TF2');
    line();
    const who = ctx ? `${config.accountName}, кошелёк ${money(ctx.wallet.balance, ctx.wallet.currency)}` : config.accountName;
    console.log(` Аккаунт: ${who}`);
    console.log(` Steam Guard: ${config.sharedSecret ? 'автоматически (maFile)' : 'код из телефона'}`);
    line();
    console.log('  1 — Проверить цены (ничего не покупает)');
    console.log('  2 — Пробный запуск (деньги не тратятся)');
    console.log('  3 — Запустить фарм (тратит деньги!)');
    console.log('  4 — Продать ключи, купленные раньше');
    console.log('  5 — Подтвердить лоты на Торговой площадке');
    console.log('  6 — Статистика');
    console.log('  7 — Статистика в браузере');
    console.log('  8 — Настройки (логин, пароль, Steam Guard, цена ключа)');
    console.log('  0 — Выход');
    line();
    console.log(' Первый раз? Начните с 1, потом 2, и только потом 3.');

    const choice = await ask('\nВведите цифру и нажмите Enter');
    if (choice === '0') break;
    const action = actions[choice];
    if (!action) {
      console.log('Такого пункта нет, введите цифру из списка.');
      continue;
    }
    try {
      await action();
    } catch (err) {
      console.log(`\n✗ Не получилось: ${err.message}`);
    }
    if (choice !== '8') await pause();
  }

  closeSession();
  if (dashboard) dashboard.close();
  console.log('Пока!');
  setTimeout(() => process.exit(0), 1000).unref();
}
