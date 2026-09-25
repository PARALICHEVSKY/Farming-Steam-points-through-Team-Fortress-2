// Local read-only dashboard over the ledger: http://localhost:DASHBOARD_PORT
import http from 'node:http';
import { config } from './config.js';
import { stats } from './ledger.js';
import { log, money } from './util.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page() {
  const s = stats();
  const m = (v) => money(v, s.currency ?? '');
  const tiles = [
    ['Куплено ключей', s.keysBought],
    ['Выставлено на ТП', s.keysListed],
    ['Ждут продажи', s.keysPending],
    ['Потрачено в магазине', m(s.spent)],
    ['Ожидаемая выручка', m(s.expectedProceeds)],
    ['Убыток (выставленные)', m(s.listedLoss)],
    ['Средний убыток на ключ', m(s.avgLossPerKey)],
    ['Очки Steam (оценка)', s.pointsEstimate],
    ['Цена 100 очков', m(s.costPer100Points)],
  ];
  const rows = s.recent.map((l) => `<tr><td>${esc(l.at.replace('T', ' ').slice(0, 19))}</td><td>${esc(l.assetid)}</td>`
    + `<td>${m(l.storePrice)}</td><td>${m(l.buyerPrice)}</td><td>${m(l.receive)}</td><td>${m(l.loss)}</td></tr>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TF2 Points Farm</title><meta http-equiv="refresh" content="30">
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c1f24;--muted:#667085;--line:#e4e7ec}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1f25;--fg:#e8eaed;--muted:#98a2b3;--line:#2a313a}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif;padding:24px 16px}
main{max-width:1000px;margin:auto}h1{font-size:22px;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.tile b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.tile span{color:var(--muted);font-size:13px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}th{color:var(--muted);font-weight:500}
</style></head><body><main><h1>Фарм очков Steam через TF2</h1>
<div class="grid">${tiles.map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
<div class="wrap"><table><thead><tr><th>Время</th><th>Asset ID</th><th>Магазин</th><th>Цена лота</th><th>Получим</th><th>Убыток</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">Пока нет выставленных ключей</td></tr>'}</tbody></table></div></main></body></html>`;
}

export function startDashboard() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats()));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page());
  });
  server.listen(config.dashboardPort, '127.0.0.1', () => log(`Дашборд: http://localhost:${config.dashboardPort}`));
  return server;
}
