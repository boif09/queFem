// Renders the Google Play graphics with headless Edge: the 1024×500 feature graphic and the phone
// screenshots with a caption on top (1080×1920). Run capture-screenshots.mjs first; needs ffmpeg to
// save the images as 24-bit PNG without alpha, which is what Google Play asks for.
// Usage: node mobile/store-listing/render-graphics.mjs [path-to-browser]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const IMAGES = path.join(HERE, 'images');
const BROWSER = process.argv[2] || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FONT = pathToFileURL(path.join(ROOT, 'node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2')).href;
const MARK = '<g transform="rotate(5 60 80)" fill="#FF4D3D"><path d="M18 43C18 17 38 1 68 1c31 0 51 17 51 44 0 20-10 32-27 44-12 9-16 15-16 28H45c0-25 8-37 25-50 11-8 17-14 17-23 0-10-7-17-19-17-13 0-20 7-21 21L18 43Z"/><circle cx="60" cy="143" r="17"/></g>';
const CAPTIONS = {
  '01-inici': 'Plans per a tot <em>Catalunya</em>',
  '02-avui': 'Què fer <em>avui</em> i aquest cap de setmana',
  '03-cerca': 'Cerca per <em>lloc</em>, data i categoria',
  '04-fitxa': 'Desa i <em>comparteix</em> qualsevol pla',
  '05-preferits': 'Els teus <em>preferits</em>, sempre a mà',
};

const BASE_CSS = `@font-face { font-family: Montserrat; src: url('${FONT}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; overflow: hidden; background: #fcf9f5; color: #1a1a1a; font-family: Montserrat, sans-serif; }
em { font-style: normal; color: #db3327; }`;

function render(name, width, height, body, css) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-graphic-'));
  const html = path.join(work, `${name}.html`);
  const raw = path.join(work, `${name}.png`);
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html, body { width: ${width}px; height: ${height}px; } ${css}</style></head><body>${body}</body></html>`);
  const shot = spawnSync(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${path.join(work, 'profile')}`, `--window-size=${width},${height}`, '--virtual-time-budget=3000',
    `--screenshot=${raw}`, pathToFileURL(html).href], { stdio: 'ignore' });
  // msedge.exe can hand the work to a background process and return before the file is written.
  const deadline = Date.now() + 20000;
  while (shot.status === 0 && !fs.existsSync(raw) && Date.now() < deadline) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
  if (shot.status !== 0 || !fs.existsSync(raw)) throw new Error(`Could not render ${name}`);
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']);
  return { raw, work };
}

function save(raw, target, pixelFormat = 'rgb24') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-pix_fmt', pixelFormat, target], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${target}`);
  console.log('saved', path.relative(ROOT, target));
}

function cleanup(work) {
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* Best effort. */ }
}

// Feature graphic 1024×500.
{
  const { raw, work } = render('feature-graphic', 1024, 500, `
<main><div class="text"><h1>Tens pla<span>?</span></h1><p>Concerts, festes, cultura i activitats<br>arreu de <em>Catalunya</em></p></div>
<svg viewBox="10 -6 120 172" aria-hidden="true">${MARK}</svg></main>`, `
main { position: relative; height: 100%; display: flex; align-items: center; padding: 0 72px; box-sizing: border-box; }
main::after { content: ""; position: absolute; left: 72px; bottom: 64px; width: 120px; height: 10px; background: #0041c8; }
h1 { margin: 0 0 22px; font-size: 104px; font-weight: 900; letter-spacing: -0.04em; line-height: 1; }
h1 span { color: #ff4d3d; }
p { margin: 0; font-size: 34px; font-weight: 700; line-height: 1.3; }
svg { position: absolute; right: 70px; top: 50%; height: 360px; transform: translateY(-50%); }`);
  save(raw, path.join(IMAGES, 'feature-graphic-1024x500.png'));
  cleanup(work);
}

// High-resolution icon 512×512, 32-bit PNG.
save(path.join(ROOT, 'frontend/public/icons/icon-512.png'), path.join(IMAGES, 'icon-512.png'), 'rgba');

// Phone screenshots with a caption, 1080×1920.
for (const [name, caption] of Object.entries(CAPTIONS)) {
  const source = path.join(IMAGES, 'screenshots', `${name}.png`);
  if (!fs.existsSync(source)) throw new Error(`Missing ${source}; run capture-screenshots.mjs first.`);
  const { raw, work } = render(name, 1080, 1920, `
<main><h1>${caption}</h1><div class="phone"><img src="${pathToFileURL(source).href}" alt=""></div></main>`, `
main { height: 100%; display: flex; flex-direction: column; align-items: center; padding-top: 110px; box-sizing: border-box; }
h1 { width: 900px; margin: 0 0 80px; font-size: 76px; font-weight: 900; letter-spacing: -0.03em; line-height: 1.08; text-align: center; }
.phone { width: 760px; flex: 1 1 auto; min-height: 0; overflow: hidden; border: 8px solid #1a1a1a; border-bottom: 0; border-radius: 56px 56px 0 0; box-shadow: 16px 16px 0 #1a1a1a; background: #fcf9f5; }
.phone img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }`);
  save(raw, path.join(IMAGES, 'phone', `${name}.png`));
  cleanup(work);
}
