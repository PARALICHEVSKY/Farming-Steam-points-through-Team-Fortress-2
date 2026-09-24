#!/usr/bin/env node
import { config } from './config.js';
import { buy, printQuote, quote, run, sell } from './bot.js';
import { acceptMarketConfirmations } from './confirm.js';
import { startDashboard } from './dashboard.js';
import { TF2GC } from './gc.js';
import { stats } from './ledger.js';
import { login, logout } from './steam.js';
import { log, money } from './util.js';

const HELP = `Использование: node src/index.js <команда> [--keys N] [--cycles N]

  run        полный цикл: купить ключи -> дождаться -> выставить по мин. цене -> подтвердить
  buy        только купить ключи в магазине TF2
  sell       выставить купленные ключи по минимальной цене и подтвердить лоты
  confirm    подтвердить висящие подтверждения лотов ТП (только лоты, не обмены)
  price      показать цены и убыток на ключ, ничего не покупая
  stats      статистика из журнала
  dashboard  локальный веб-дашборд со статистикой

DRY_RUN=${config.dryRun} (в .env). Пока DRY_RUN=true, ничего не покупается и не выставляется.`;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} ожидает целое число >= 1`);
  return n;
}

function printStats() {
  const s = stats();
  const m = (v) => money(v, s.currency ?? '');
  console.log(`Куплено ключей:          ${s.keysBought}`);
  console.log(`Выставлено на ТП:        ${s.keysListed}`);
  console.log(`Ждут продажи:            ${s.keysPending}`);
  console.log(`Потрачено в магазине:    ${m(s.spent)}`);
  console.log(`Ожидаемая выручка:       ${m(s.expectedProceeds)}`);
  console.log(`Убыток (выставленные):   ${m(s.listedLoss)}`);
  console.log(`Средний убыток на ключ:  ${m(s.avgLossPerKey)}`);
  console.log(`Очки Steam (оценка):     ${s.pointsEstimate}`);
  console.log(`Цена 100 очков:          ${m(s.costPer100Points)}`);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || cmd === '--help') return console.log(HELP);
  if (cmd === 'stats') return printStats();
  if (cmd === 'dashboard') return startDashboard();

  const commands = ['run', 'buy', 'sell', 'confirm', 'price'];
  if (!commands.includes(cmd)) {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const keys = arg('keys', config.keysPerCycle);
  const cycles = arg('cycles', config.cycles);
  if (config.dryRun) log('DRY_RUN включён: покупки и продажи только симулируются');

  const ctx = await login();
  log(`Кошелёк: ${money(ctx.wallet.balance, ctx.wallet.currency)}, страна ${ctx.country}`);
  try {
    if (cmd === 'price') {
      printQuote(await quote(ctx));
    } else if (cmd === 'confirm') {
      log(`Подтверждено: ${await acceptMarketConfirmations(ctx.community)}`);
    } else if (cmd === 'sell') {
      await sell(ctx);
    } else {
      const gc = new TF2GC(ctx.user);
      await gc.connect();
      if (cmd === 'buy') await buy(ctx, gc, keys);
      else await run(ctx, gc, { cycles, keys });
    }
  } finally {
    logout(ctx);
    setTimeout(() => process.exit(process.exitCode || 0), 1500).unref();
  }
}

main().catch((err) => {
  log(`Ошибка: ${err.message}`);
  process.exit(1);
});
