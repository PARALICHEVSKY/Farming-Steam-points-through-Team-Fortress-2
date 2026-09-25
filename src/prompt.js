// Small console-input helpers for the interactive wizard and menu.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

function createRl(opts = {}) {
  const rl = readline.createInterface({ input: stdin, output: stdout, ...opts });
  // Without this, Ctrl+C at a prompt only pauses input instead of quitting.
  rl.on('SIGINT', () => {
    rl.close();
    stdout.write('\n');
    process.exit(0);
  });
  return rl;
}

export async function ask(question, def = '') {
  const rl = createRl();
  try {
    const hint = def ? ` [Enter = ${def}]` : '';
    const answer = (await rl.question(`${question}${hint}: `)).trim();
    return answer || def;
  } finally {
    rl.close();
  }
}

/** Asks for a secret, showing * instead of the typed characters (for the password). */
export async function askHidden(question) {
  if (!stdin.isTTY) return ask(question);
  stdout.write(`${question}: `);
  return new Promise((resolve) => {
    let value = '';
    const finish = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') { // Ctrl+C
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(0);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          stdout.write('*');
        }
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

export async function askNumber(question, def, { min = 1, max = 1000 } = {}) {
  for (;;) {
    const raw = await ask(question, String(def));
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    console.log(`  Нужно целое число от ${min} до ${max}.`);
  }
}

/** Parses a price typed like it's shown in the game ("2.49", "2,49", "185 руб") into minor units. */
export function parsePrice(raw) {
  const cleaned = String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  if (!cleaned || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Yes/no question. Only an explicit yes counts. */
export async function confirm(question) {
  const a = (await ask(`${question} (да/нет)`)).toLowerCase();
  return ['да', 'д', 'yes', 'y', 'lf'].includes(a);
}

export async function pause() {
  await ask('\nНажмите Enter, чтобы вернуться в меню');
}
