// Checks every Gencat image address used by an active plan against the origin and records the ones Gencat no longer
// serves (HTTP 404/410), so the API stops offering them and the plan shows a generic photo instead of a broken image
// (see migration 019 and backend/src/db/repositories/imageAvailability.js). The media route does the same one image at a
// time when somebody views it; this finds them all at once.
//
// Default is a read-only dry-run that only reports. With --apply it marks the dead addresses and clears the mark of any
// that answer again. Only a definitive 404/410 is ever recorded: a timeout, a 5xx or anything else is reported as
// "unknown" and left untouched. Each distinct address is requested once, a few at a time, with a pause between requests.
//
//   node scripts/sweep-gencat-images.js                  # dry-run
//   node scripts/sweep-gencat-images.js --apply
//   node scripts/sweep-gencat-images.js --concurrency=2 --delay-ms=300
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { PlanSourceImageRepository } from '../backend/src/db/repositories/planSourceImage.repository.js';
import { validateGencatImageUrl } from '../backend/src/ticketmaster/imageProxy.js';

const IMAGE_TYPES = new Set(['image/avif', 'image/webp', 'image/png', 'image/jpeg', 'image/gif']);

// Distinct image addresses of active Gencat plans (a card and a detail row usually share one), with whether they are
// currently marked.
export function collectSweepTargets(db) {
  return db.prepare(`
    SELECT psi.url, MAX(psi.unavailable_at IS NOT NULL) AS marked, COUNT(*) AS rows
    FROM plan_source_images psi
    JOIN plan_sources ps ON ps.id = psi.plan_source_id
    JOIN sources s ON s.id = ps.source_id
    JOIN plans p ON p.id = ps.plan_id
    WHERE s.key = 'gencat-agenda' AND s.allows_images = 1 AND psi.attribution_known = 1 AND p.status = 'active'
    GROUP BY psi.url
    ORDER BY psi.url
  `).all().map((row) => ({ url: row.url, marked: row.marked === 1, rows: row.rows }));
}

// 'ok' (served an image), 'dead' (404/410) or 'unknown' (everything else, with the reason).
export async function probeImage(url, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  let validated;
  try { validated = validateGencatImageUrl(url); } catch { return { state: 'unknown', reason: 'address outside the Gencat image area' }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(validated, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }, redirect: 'manual', signal: controller.signal });
    try { await response.body?.cancel(); } catch { /* the body is not needed, only the status line */ }
    if (response.status === 404 || response.status === 410) return { state: 'dead', status: response.status };
    const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (response.status === 200 && IMAGE_TYPES.has(type)) return { state: 'ok', status: 200 };
    return { state: 'unknown', reason: `HTTP ${response.status}${type ? ` ${type}` : ''}` };
  } catch (error) {
    return { state: 'unknown', reason: error.name === 'AbortError' ? 'timeout' : `request failed (${error.cause?.code || error.message})` };
  } finally { clearTimeout(timer); }
}

const pause = (milliseconds) => (milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve());

export async function sweepGencatImages(db, {
  fetchImpl, apply = false, concurrency = 4, delayMs = 150, timeoutMs, now = () => new Date(), onProgress,
} = {}) {
  const repository = new PlanSourceImageRepository(db, { now });
  const targets = collectSweepTargets(db);
  const results = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const index = next++;
      results[index] = { ...targets[index], ...(await probeImage(targets[index].url, { fetchImpl, timeoutMs })) };
      onProgress?.(index + 1, targets.length);
      await pause(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  const dead = results.filter((r) => r.state === 'dead');
  const newlyDead = dead.filter((r) => !r.marked);
  const recovered = results.filter((r) => r.state === 'ok' && r.marked);
  const unknown = results.filter((r) => r.state === 'unknown');
  if (apply) {
    // One transaction for every mark and every clear: a failure part-way leaves the table exactly as it was.
    db.transaction(() => {
      for (const group of [404, 410]) {
        const urls = newlyDead.filter((r) => r.status === group).map((r) => r.url);
        if (urls.length) repository.markUrlsUnavailable(urls, group);
      }
      if (recovered.length) repository.clearUnavailableUrls(recovered.map((r) => r.url));
    })();
  }
  return {
    checked: results.length, ok: results.filter((r) => r.state === 'ok').length,
    dead, newlyDead, recovered, unknown, applied: apply,
  };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const get = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
  const number = (name, fallback) => {
    const raw = get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be a whole number.`);
    return Number.parseInt(raw, 10);
  };
  const concurrency = Math.min(8, Math.max(1, number('concurrency', 4)));
  const delayMs = number('delay-ms', 150);
  const config = loadConfig();
  const db = openDatabase(config.databasePath, apply ? { readonly: false, configureJournal: true } : { readonly: true });
  return sweepGencatImages(db, {
    apply, concurrency, delayMs,
    onProgress: (done, total) => { if (done % 200 === 0 || done === total) console.error(`  ${done}/${total} addresses checked`); },
  }).then((summary) => {
    console.log(`${summary.checked} distinct image addresses checked: ${summary.ok} serve an image, ${summary.dead.length} are gone at the origin (${summary.newlyDead.length} not yet marked), ${summary.recovered.length} marked ones are back, ${summary.unknown.length} could not be judged (left untouched).`);
    for (const row of summary.newlyDead.slice(0, 40)) console.log(`  gone ${row.status}  ${row.url}`);
    if (summary.newlyDead.length > 40) console.log(`  … and ${summary.newlyDead.length - 40} more`);
    for (const row of summary.unknown.slice(0, 10)) console.log(`  unknown (${row.reason})  ${row.url}`);
    if (!apply) { console.log('\nDry-run only. Add --apply to record the gone addresses and clear the recovered ones.'); return; }
    const outDir = path.resolve(config.projectRoot, 'data/consolidation-logs');
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `gencat-image-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ dbPath: config.databasePath, newlyDead: summary.newlyDead, recovered: summary.recovered, unknown: summary.unknown }, null, 2));
    console.log(`\nApplied. Log: ${file}`);
  }).finally(() => db.close());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(`Sweep failed: ${error.message}`); process.exitCode = 1; }
}
