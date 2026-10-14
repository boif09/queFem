// Starts the private DIBA review page. It binds to 127.0.0.1 only (the host cannot be changed) and is meant to be
// opened through an SSH tunnel; see scripts/open-review-page.cmd and docs/DEPLOYMENT.md. It is not a PM2 process, not
// behind Nginx and exits by itself after a period without requests.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { reviewQueuePath } from '../diba/reviewQueue.js';
import { createReviewApp } from '../review/reviewApp.js';

export const REVIEW_HOST = '127.0.0.1';

export function startReviewServer({ config = loadConfig(), port = Number.parseInt(process.env.REVIEW_PORT ?? '3015', 10), idleMinutes = Number.parseInt(process.env.REVIEW_IDLE_MINUTES ?? '180', 10), log = console.log } = {}) {
  const db = openDatabase(config.databasePath);
  // The launcher chooses the token and passes it in REVIEW_TOKEN; without it a random one is generated and printed.
  const supplied = process.env.REVIEW_TOKEN;
  if (supplied && !/^[0-9a-f]{32,128}$/.test(supplied)) throw new Error('REVIEW_TOKEN must be 32-128 hexadecimal characters.');
  const token = supplied || crypto.randomBytes(24).toString('hex');
  let armIdleTimer = () => {};
  // Only token-authenticated requests keep the page alive; stray local traffic cannot extend it.
  const app = createReviewApp({ db, databasePath: config.databasePath, queuePath: reviewQueuePath(config.databasePath), token, onActivity: () => armIdleTimer() });
  const server = app.listen(port, REVIEW_HOST, () => {
    log(`Página de revisión DIBA lista (solo accesible por túnel SSH; se cierra tras ${idleMinutes} min sin uso).`);
    if (!supplied) log(`Abre http://localhost:${port}/?t=${token}`);
  });
  let idle;
  armIdleTimer = () => { clearTimeout(idle); idle = setTimeout(() => shutdown('inactividad'), idleMinutes * 60_000); };
  const shutdown = (reason) => {
    log(`Cerrando la página de revisión (${reason}).`);
    clearTimeout(idle);
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  armIdleTimer();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => shutdown(signal));
  return { server, db, token, shutdown };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { startReviewServer(); } catch (error) { console.error(`No se pudo iniciar la página de revisión: ${error.message}`); process.exitCode = 1; }
}
