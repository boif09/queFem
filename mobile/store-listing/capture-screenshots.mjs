// Captures the Google Play phone screenshots (1080×2160, 2:1) from https://tenspla.cat with headless Edge or
// Chrome through the DevTools protocol. Umami is blocked so the captures do not count as visits.
// Usage: node mobile/store-listing/capture-screenshots.mjs [path-to-browser]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://tenspla.cat';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'images', 'screenshots');
const BROWSER = process.argv[2] || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOTS = [
  { name: '01-inici', path: '/', ready: '.plan-card' },
  { name: '02-avui', path: '/avui', ready: '.plan-card' },
  { name: '03-cerca', path: '/plans', ready: '.plan-card' },
  { name: '04-fitxa', path: '/plans/{plan}', ready: '.detail-actions', scroll: '.detail-actions' },
  { name: '05-preferits', path: '/preferits', ready: '.favorites-page .plan-card', favorites: true },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The browser picks a free port and writes it to DevToolsActivePort in its own profile, so this never
// attaches to another browser that is already running.
async function waitForTarget(profile) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(String.fromCharCode(10))[0].trim();
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* The browser is still starting. */ }
    await sleep(200);
  }
  throw new Error('The browser did not expose a page target.');
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const ready = new Promise((resolve) => socket.addEventListener('open', resolve));
  const send = async (method, params = {}) => {
    await ready;
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  return { send, close: () => socket.close() };
}

async function evaluate(cdp, expression) {
  const { result } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.value;
}

async function load(cdp, url, selector) {
  await cdp.send('Page.navigate', { url });
  const check = `document.readyState === 'complete' && !document.querySelector('.loader') && Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(250);
    if (await evaluate(cdp, check)) {
      await sleep(1500);
      return;
    }
  }
  throw new Error(`${url} did not finish loading (waiting for ${selector}); no screenshot was saved.`);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-shots-'));
const browser = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`,
  '--remote-debugging-port=0', '--host-resolver-rules=MAP stats.tenspla.cat 0.0.0.0', 'about:blank',
], { stdio: 'ignore' });

try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdp = connect(await waitForTarget(profile));
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 720, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });

  await load(cdp, `${ORIGIN}/avui`, '.plan-card');
  const planIds = await evaluate(cdp, `[...document.querySelectorAll('.plan-card-link')].map((a) => a.getAttribute('href').split('/').pop()).slice(0, 3)`);
  if (!planIds?.length) throw new Error('No plans found to use in the plan and favourites screenshots.');

  for (const shot of SHOTS) {
    if (shot.favorites) {
      const items = planIds.map((id, index) => ({ id, title: '', savedAt: new Date(Date.now() - index * 60000).toISOString() }));
      await evaluate(cdp, `localStorage.setItem('quefem.favorites', ${JSON.stringify(JSON.stringify({ version: 1, items }))})`);
    }
    await load(cdp, `${ORIGIN}${shot.path.replace('{plan}', planIds[0])}`, shot.ready);
    if (shot.scroll) await evaluate(cdp, `document.querySelector(${JSON.stringify(shot.scroll)})?.scrollIntoView({ block: 'center' })`);
    else await evaluate(cdp, 'window.scrollTo(0, 0)');
    await sleep(800);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, `${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('saved', path.relative(process.cwd(), file));
  }
  cdp.close();
} finally {
  browser.kill();
  await sleep(1500);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.warn(`Could not delete the temporary browser profile ${profile}; it is safe to remove it by hand.`);
  }
}
