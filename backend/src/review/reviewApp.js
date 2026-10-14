import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { applyMerge, computeMergePlan, rollbackStatements } from '../deduplication/duplicatePlanMerge.js';
import { DibaImportLock } from '../diba/importLock.js';
import { DibaReviewDecisionRepository } from '../diba/reviewDecisions.js';

// Private review page for the DIBA review queue. It is meant to listen on the loopback interface only and be
// reached through an SSH tunnel: there is no login, so nothing here may ever be proxied by Nginx. The checks below
// protect the one remaining attacker, a web page open in the operator's own browser that targets the tunnelled
// localhost port (cross-site requests and DNS rebinding).
const PUBLIC_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const PUBLIC_PLAN_ORIGIN = 'https://tenspla.cat';

function hostnameOf(value) {
  try { return new URL(`http://${value}`).hostname; } catch { return null; }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readQueue(queuePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    return parsed && Array.isArray(parsed.items) ? parsed : { items: [], updatedAt: null };
  } catch { return { items: [], updatedAt: null }; }
}

export function createReviewApp({
  db, databasePath, queuePath, token, decidedBy = 'project-owner', now = () => new Date(),
  lockFactory = (pathValue) => new DibaImportLock(pathValue), publicDirectory = PUBLIC_DIRECTORY, onActivity = () => {},
}) {
  if (!token || String(token).length < 16) throw new Error('A review token of at least 16 characters is required.');
  const decisions = new DibaReviewDecisionRepository(db);
  if (!decisions.available) throw new Error('Table diba_review_decisions is missing; run npm run db:init first.');
  const app = express();
  app.disable('x-powered-by');

  const planRow = db.prepare(`SELECT p.id, p.original_title AS title, p.start_date AS startDate, p.end_date AS endDate,
    p.municipality, p.venue_name AS venue, p.address, p.schedule_text AS schedule, p.status, p.is_free AS isFree,
    (SELECT group_concat(DISTINCT s.key) FROM plan_sources x JOIN sources s ON s.id = x.source_id WHERE x.plan_id = p.id) AS sources,
    (SELECT canonical_plan_id FROM plan_aliases WHERE alias_plan_id = p.id) AS aliasOf
    FROM plans p WHERE p.id = ?`);
  const planOfRecord = db.prepare(`SELECT ps.plan_id AS planId, ps.source_url AS url, ps.source_payload_json AS payload FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
    WHERE s.key = ? AND ps.source_record_id = ?`);

  // DIBA keeps the start time only in its raw payload (plans store dates), and it is what tells two sessions apart.
  const startOf = (payload) => {
    try { const value = JSON.parse(payload ?? '{}').data_inici; return typeof value === 'string' && value.length <= 32 ? value : null; } catch { return null; }
  };

  const describePlan = (planId) => {
    const row = planRow.get(planId);
    if (!row) return { id: planId, missing: true };
    return { ...row, sources: row.sources ? row.sources.split(',') : [], url: `${PUBLIC_PLAN_ORIGIN}/plans/${row.id}` };
  };

  // Which plans a merge would join, taken from our own data (never from the request).
  const mergeCandidate = (item, records) => {
    let aliasPlanId; let canonicalPlanId;
    if (item.kind === 'POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN' && records.length === 1 && item.candidatePlans.length === 1) {
      aliasPlanId = records[0].planId; canonicalPlanId = item.candidatePlans[0].planId;
    } else if (item.kind === 'POSSIBLE_DUPLICATE_WITHIN_FEED' && records.length === 2 && records.every((record) => record.planId)) {
      // Two sessions of one production start at different times; a plan has no sessions, so merging would lose one.
      if (records[0].startsAt && records[1].startsAt && records[0].startsAt !== records[1].startsAt) {
        return { available: false, problems: ['Tienen hora de inicio distinta: son sesiones diferentes.'] };
      }
      [canonicalPlanId, aliasPlanId] = [records[0].planId, records[1].planId].sort((a, b) => a - b);
    } else return { available: false, problems: ['Este caso no admite fusión automática.'] };
    if (!aliasPlanId || !canonicalPlanId) return { available: false, problems: ['El registro todavía no se ha importado.'] };
    if (aliasPlanId === canonicalPlanId) return { available: false, resolved: true, problems: [] };
    const canonical = planRow.get(canonicalPlanId);
    if (!canonical) return { available: false, problems: ['El plan destino ya no existe.'] };
    const plan = computeMergePlan(db, {
      aliasPlanId, canonicalPlanId, title: canonical.title, decision: 'MERGE',
      reason: 'Confirmed as the same event on the private review page', reviewedAt: now().toISOString().slice(0, 10), reviewer: decidedBy,
    });
    return { available: plan.ok, problems: plan.problems, aliasPlanId, canonicalPlanId, plan };
  };

  const enrich = (item) => {
    const records = item.records.map((record) => {
      const found = planOfRecord.get(item.sourceKey, record.sourceRecordId);
      return { ...record, planId: found?.planId ?? null, sourceUrl: found?.url ?? record.url ?? null, startsAt: startOf(found?.payload) };
    });
    const candidatePlans = item.candidatePlans.map((candidate) => describePlan(candidate.planId));
    const merge = mergeCandidate(item, records);
    return { item, records, candidatePlans, merge };
  };

  const view = ({ item, records, candidatePlans, merge }) => ({
    id: item.id, kind: item.kind, dataset: item.dataset, sourceKey: item.sourceKey, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
    records: records.map((record) => ({ ...record, plan: record.planId ? describePlan(record.planId) : null })),
    candidatePlans,
    actions: { keepSeparate: true, merge: { available: merge.available, problems: merge.problems } },
  });

  const openItems = () => {
    const queue = readQueue(queuePath);
    const decided = decisions.decidedItemIds();
    const open = []; const stale = [];
    for (const item of queue.items) {
      if (item.kind === 'STALE_REVIEW_DECISION') { stale.push({ id: item.id, sourceKey: item.sourceKey, records: item.records, staleTarget: item.staleTarget }); continue; }
      if (decided.has(item.id)) continue;
      const enriched = enrich(item);
      if (enriched.merge.resolved) continue;
      open.push(enriched);
    }
    return { queue, open, stale };
  };

  const recentDecisions = () => decisions.recent(30).map((row) => ({
    itemId: row.item_id, decision: row.decision, sourceKey: row.source_key, sourceRecordId: row.source_record_id,
    aliasPlanId: row.alias_plan_id, canonicalPlanId: row.canonical_plan_id, decidedAt: row.decided_at, decidedBy: row.decided_by,
    title: row.canonical_plan_id ? planRow.get(row.canonical_plan_id)?.title ?? null : null,
  }));

  // --- security: host, origin and token ---------------------------------------------------------------------------
  app.use((request, response, next) => {
    response.set({
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    });
    if (!ALLOWED_HOSTNAMES.has(hostnameOf(request.headers.host ?? ''))) { response.status(403).type('text/plain').send('Forbidden host'); return; }
    next();
  });
  const requireToken = (request, response, next) => {
    if (!safeEqual(request.headers['x-review-token'] ?? '', token)) { response.status(403).json({ error: 'Token no válido. Recarga la página.' }); return; }
    onActivity();
    next();
  };
  const requireWriteAccess = (request, response, next) => {
    const origin = request.headers.origin;
    if (origin !== undefined && !ALLOWED_HOSTNAMES.has(hostnameOf(String(origin).replace(/^https?:\/\//, '')))) { response.status(403).json({ error: 'Origen no permitido.' }); return; }
    if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) { response.status(403).json({ error: 'Petición de otro sitio.' }); return; }
    if (!request.is('application/json')) { response.status(415).json({ error: 'Se esperaba JSON.' }); return; }
    if (!safeEqual(request.headers['x-review-token'] ?? '', token)) { response.status(403).json({ error: 'Token no válido. Recarga la página.' }); return; }
    onActivity();
    next();
  };

  // --- static page -------------------------------------------------------------------------------------------------
  const asset = (name) => fs.readFileSync(path.join(publicDirectory, name), 'utf8');
  const pageSecurity = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
  // The page is only handed out to whoever knows the launch token (it is part of the URL the launcher opens), so a
  // process that merely reaches the loopback port from the same server cannot read it.
  app.get('/', (request, response) => {
    if (typeof request.query.t !== 'string' || !safeEqual(request.query.t, token)) { response.status(403).type('text/plain').send('Falta el token de acceso. Abre la página con el lanzador.'); return; }
    onActivity();
    response.set(pageSecurity).type('html').send(asset('index.html').replace('__REVIEW_TOKEN__', token));
  });
  app.get('/app.js', (request, response) => { response.set(pageSecurity).type('application/javascript').send(asset('app.js')); });
  app.get('/app.css', (request, response) => { response.set(pageSecurity).type('text/css').send(asset('app.css')); });

  // --- API ---------------------------------------------------------------------------------------------------------
  app.get('/api/items', requireToken, (request, response) => {
    const { queue, open, stale } = openItems();
    response.json({
      generatedAt: now().toISOString(), queueUpdatedAt: queue.updatedAt ?? null,
      items: open.map(view), stale, recent: recentDecisions(),
    });
  });

  const findOpenItem = (id) => openItems().open.find(({ item }) => item.id === id);

  app.post('/api/items/:id/keep-separate', requireWriteAccess, express.json({ limit: '2kb' }), (request, response) => {
    const found = findOpenItem(request.params.id);
    if (!found) { response.status(404).json({ error: 'Caso no encontrado o ya resuelto.' }); return; }
    try {
      decisions.record({
        itemId: found.item.id, members: found.item.records.map(({ sourceRecordId }) => ({ sourceKey: found.item.sourceKey, sourceRecordId })),
        decision: 'KEEP_SEPARATE', decidedBy, now: now().toISOString(),
      });
    } catch (error) { response.status(409).json({ error: error.message }); return; }
    response.json({ ok: true, decision: 'KEEP_SEPARATE' });
  });

  app.post('/api/items/:id/merge', requireWriteAccess, express.json({ limit: '2kb' }), async (request, response) => {
    const found = findOpenItem(request.params.id);
    if (!found) { response.status(404).json({ error: 'Caso no encontrado o ya resuelto.' }); return; }
    if (!found.merge.available) { response.status(409).json({ error: 'No se puede fusionar.', problems: found.merge.problems }); return; }
    const lock = lockFactory(databasePath);
    if (!await lock.acquire()) { response.status(409).json({ error: 'Hay una importación de DIBA en curso. Inténtalo en unos minutos.' }); return; }
    try {
      const done = db.transaction(() => {
        const merged = applyMerge(db, found.merge.plan, { now: now().toISOString() });
        decisions.record({
          itemId: found.item.id,
          members: merged.sourceRows.map((row) => ({ sourceKey: row.source_key, sourceRecordId: row.source_record_id })),
          decision: 'MERGED', aliasPlanId: merged.aliasPlanId, canonicalPlanId: merged.canonicalPlanId,
          rollbackSql: rollbackStatements(merged).join('\n'), decidedBy, now: now().toISOString(),
        });
        return merged;
      })();
      response.json({ ok: true, decision: 'MERGED', aliasPlanId: done.aliasPlanId, canonicalPlanId: done.canonicalPlanId });
    } catch (error) {
      response.status(409).json({ error: `No se pudo fusionar: ${error.message}` });
    } finally { await lock.release(); }
  });

  app.post('/api/items/:id/undo', requireWriteAccess, express.json({ limit: '2kb' }), (request, response) => {
    try {
      const removed = decisions.undoKeepSeparate(request.params.id);
      if (!removed) { response.status(404).json({ error: 'No hay una decisión de «mantener separado» para deshacer.' }); return; }
      response.json({ ok: true, removed });
    } catch (error) { response.status(409).json({ error: error.message }); }
  });

  app.use((request, response) => { response.status(404).json({ error: 'No encontrado.' }); });
  app.use((error, request, response, _next) => { response.status(error.status === 413 ? 413 : 400).json({ error: 'Petición no válida.' }); });
  return app;
}
