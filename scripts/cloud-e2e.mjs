// E2E облачного режима: статический фронтенд + мок Supabase Auth/PostgREST.
// Запуск: node scripts/cloud-e2e.mjs (нужен Edge в стандартном пути Windows).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const SHOTS = path.join(ROOT, '_shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const STATIC_PORT = 8080;
const MOCK_PORT = 3010;
const CDP_PORT = 9335;
const CONFIG = { supabaseUrl: `http://127.0.0.1:${MOCK_PORT}`, supabaseAnonKey: 'test-anon-key' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const staticServer = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // Эмулируем GitHub Pages project site: /futures-journal/...
  if (pathname === '/repo' || pathname.startsWith('/repo/')) pathname = pathname.slice('/repo'.length) || '/';
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => staticServer.listen(STATIC_PORT, '127.0.0.1', r));

const mock = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-supabase.js')], {
  cwd: ROOT,
  env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
  stdio: 'ignore',
});
await sleep(500);

const profile = path.join(os.tmpdir(), `fd-cloud-e2e-${Date.now()}`);
const edge = spawn(EDGE, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-features=NetworkServiceSandbox', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
  'about:blank',
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* wait */ }
    await sleep(200);
  }
  throw new Error('CDP не поднялся');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(d.exception?.description || d.text || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
};
const waitFor = async (expression, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
  console.log('shot', name);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('fd.cloud.override', ${JSON.stringify(JSON.stringify(CONFIG))});`,
});
await send('Page.navigate', { url: `http://127.0.0.1:${STATIC_PORT}/repo/#/dashboard` });

if (!await waitFor('!!document.querySelector(".auth-card")')) throw new Error('Экран входа не появился');
await shot('cloud-auth.png');

await evaluate(`document.querySelector('[data-auth-tab="signup"]').click()`);
await evaluate(`(() => {
  const set = (sel, v) => { document.querySelector(sel).value = v; };
  set('#authEmail', 'trader@example.com');
  set('#authPassword', 'secret123');
  set('#authConfirm', 'secret123');
  document.querySelector('#authForm').requestSubmit();
})()`);

if (!await waitFor('!!document.querySelector(".empty-title") || !!document.querySelector(".auth-error:not(.hidden)")', 20000)) {
  throw new Error('После регистрации не появился дашборд');
}
const authError = await evaluate('document.querySelector(".auth-error:not(.hidden)")?.textContent || ""');
if (authError) throw new Error(`Ошибка регистрации: ${authError}`);
await shot('cloud-empty.png');

const sessionRaw = await evaluate('localStorage.getItem("fd.cloud.session")');
const session = JSON.parse(sessionRaw);
console.log('session email', session.user?.email, 'token', session.access_token?.slice(0, 8));

async function mockRows(table) {
  const res = await fetch(`http://127.0.0.1:${MOCK_PORT}/rest/v1/${table}?select=*`, {
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: 'test' },
  });
  return res.json();
}
console.log('initial accounts', (await mockRows('accounts')).length, 'instruments', (await mockRows('instruments')).length);

await evaluate('document.querySelector("[data-demo]").click()');
if (!await waitFor('!!document.querySelector(".kpis")', 25000)) throw new Error('Демо-данные не загрузились');
await sleep(600);
await shot('cloud-dashboard.png');
const accounts = await mockRows('accounts');
const trades = await mockRows('trades');
const journal = await mockRows('journal');
console.log('after demo', { accounts: accounts.length, trades: trades.length, journal: journal.length, account: accounts[0]?.name });

// ---- upsert дневника ----
await evaluate('location.hash = "#/journal"');
if (!await waitFor('!!document.querySelector("#jPlan")')) throw new Error('Дневник не открылся');
const today = await evaluate(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
await evaluate(`document.querySelector('#jPlan').value = 'E2E план после демо'; document.querySelector('[data-save]').click()`);
await sleep(1500);
const journalAfter = await mockRows('journal');
const todayEntry = journalAfter.find((j) => j.date === today);
console.log('journal upsert', { day: today, rows: journalAfter.length, plan: todayEntry?.plan });
if (!todayEntry || todayEntry.plan !== 'E2E план после демо') throw new Error('Upsert дневника не сработал');

// ---- обновление счёта (PATCH) ----
await evaluate('location.hash = "#/settings"');
if (!await waitFor('!!document.querySelector("[data-logout]")')) throw new Error('Настройки не открылись');
await shot('cloud-settings.png');
await evaluate(`document.querySelector('#accName').value = 'Demo Cloud'; document.querySelector('[data-save-account]').click()`);
await sleep(1500);
const accountsAfter = await mockRows('accounts');
console.log('account patch', accountsAfter[0]?.name);
if (accountsAfter[0]?.name !== 'Demo Cloud') throw new Error('PATCH счёта не сработал');

await evaluate('document.querySelector("[data-logout]").click()');
if (!await waitFor('!!document.querySelector(".auth-card")', 10000)) throw new Error('Выход не вернул экран входа');
console.log('logout ok');
await shot('cloud-auth-after-logout.png');

console.log('console errors:', JSON.stringify(errors, null, 2));
console.log('RESULT', JSON.stringify({ ok: errors.length === 0 && trades.length > 100, accounts: accounts.length, trades: trades.length }));

ws.close();
edge.kill();
mock.kill();
staticServer.close();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
