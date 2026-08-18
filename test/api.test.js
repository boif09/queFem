import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { withTestDatabase } from './helpers.js';

function insertPlan(db, values) {
  const now = '2026-08-17T10:00:00.000Z';
  return Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_language, original_title, original_description,
      title_ca, title_es, description_ca, description_es,
      start_date, end_date, permanent, is_free,
      province, comarca, municipality, venue_name,
      family_friendly, indoor, outdoor, quality_score, status, created_at, updated_at
    ) VALUES (
      @kind, @fingerprint, 'ca', @original_title, @original_description,
      @title_ca, @title_es, @description_ca, @description_es,
      @start_date, @end_date, @permanent, @is_free,
      @province, @comarca, @municipality, @venue_name,
      @family_friendly, @indoor, @outdoor, @quality_score, 'active', @created_at, @updated_at
    )
  `).run({
    kind: 'event',
    original_description: null,
    title_es: null,
    description_ca: null,
    description_es: null,
    start_date: null,
    end_date: null,
    permanent: 0,
    is_free: null,
    province: 'Girona',
    comarca: null,
    municipality: null,
    venue_name: null,
    family_friendly: null,
    indoor: null,
    outdoor: null,
    quality_score: 70,
    created_at: now,
    updated_at: now,
    ...values,
  }).lastInsertRowid);
}

function linkCategory(db, planId, slug) {
  db.prepare(`
    INSERT INTO plan_categories (plan_id, category_id)
    SELECT ?, id FROM categories WHERE slug = ?
  `).run(planId, slug);
}

function seedApiData(db) {
  const event = insertPlan(db, {
    fingerprint: 'concert|palafrugell|2026-08-20',
    original_title: 'Concert original català',
    original_description: 'Descripció original del concert',
    title_ca: 'Concert català',
    description_ca: 'Descripció catalana',
    start_date: '2026-08-20',
    end_date: '2026-08-20',
    is_free: 1,
    comarca: 'Baix Emporda',
    municipality: 'Palafrugell',
    venue_name: 'Plaça Nova',
    family_friendly: 1,
    indoor: 0,
    outdoor: 1,
    quality_score: 80,
  });
  linkCategory(db, event, 'musica');

  const translatedEvent = insertPlan(db, {
    fingerprint: 'exposicio|barcelona|2026-08-22',
    original_title: 'Exposició temporal',
    original_description: 'Descripció original de l’exposició',
    title_ca: 'Exposició temporal',
    title_es: 'Exposición temporal',
    description_ca: 'Descripció catalana de l’exposició',
    description_es: 'Descripción castellana de la exposición',
    start_date: '2026-08-22',
    end_date: '2026-08-30',
    is_free: 0,
    province: 'Barcelona',
    comarca: 'Barcelones',
    municipality: 'Barcelona',
    venue_name: 'Centre Cultural',
    family_friendly: 0,
    indoor: 1,
    outdoor: 0,
    quality_score: 90,
  });
  linkCategory(db, translatedEvent, 'cultura');

  const permanent = insertPlan(db, {
    kind: 'place',
    fingerprint: 'museu|begur|permanent',
    original_title: 'Museu permanent',
    original_description: 'Col·lecció permanent',
    title_ca: 'Museu permanent',
    description_ca: 'Col·lecció permanent',
    permanent: 1,
    comarca: 'Baix Emporda',
    municipality: 'Begur',
    venue_name: 'Museu de Begur',
    quality_score: 70,
  });
  linkCategory(db, permanent, 'museus');

  insertPlan(db, {
    fingerprint: 'registre-baixa-qualitat|pals|2026-08-20',
    original_title: 'Registre de baixa qualitat',
    title_ca: 'Registre de baixa qualitat',
    start_date: '2026-08-20',
    end_date: '2026-08-20',
    comarca: 'Baix Emporda',
    municipality: 'Pals',
    quality_score: 20,
  });

  const expired = insertPlan(db, {
    fingerprint: 'expired|girona|2026-08-16',
    original_title: 'Esdeveniment caducat',
    title_ca: 'Esdeveniment caducat',
    start_date: '2026-08-16',
    end_date: '2026-08-16',
    comarca: 'Girones',
    municipality: 'Girona',
  });

  const outsideCatalonia = insertPlan(db, {
    fingerprint: 'outside|buenos-aires|2026-08-20',
    original_title: 'Esdeveniment fora de Catalunya',
    title_ca: 'Esdeveniment fora de Catalunya',
    start_date: '2026-08-20',
    end_date: '2026-08-20',
    province: 'Fora Catalunya',
    comarca: 'Fora Espanya',
    municipality: null,
  });

  const temporallyInvalid = insertPlan(db, {
    fingerprint: 'espai-vapor|terrassa|2024-06-28',
    original_title: 'Espai Vapor',
    title_ca: 'Espai Vapor',
    start_date: '2024-06-28',
    end_date: '2924-06-30',
    province: 'Barcelona',
    comarca: 'Valles Occidental',
    municipality: 'Terrassa',
  });

  const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
  db.prepare(`
    INSERT INTO plan_sources (
      plan_id, source_id, source_record_id, source_url, source_created_at,
      source_updated_at, source_payload_json, imported_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event,
    source.id,
    'fixture@1234567890abcdef',
    'https://agenda.cultura.gencat.cat/fixture',
    '2026-08-01T10:00:00.000',
    '2026-08-17T08:00:00.000Z',
    JSON.stringify({ codi: 'fixture' }),
    '2026-08-17T09:00:00.000Z',
    '2026-08-17T09:00:00.000Z',
  );

  return {
    event, translatedEvent, permanent, expired, outsideCatalonia, temporallyInvalid,
  };
}

test('Milestone 2 REST API', async (context) => {
  await withTestDatabase(async (db) => {
    const ids = seedApiData(db);
    const app = createApp({
      db,
      defaultLanguage: 'ca',
      eventRetentionDays: 0,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
      logger: { error() {} },
    });
    const apiRequest = async (path) => {
      const response = await request(app).get(path);
      return { response, body: response.body };
    };

      await context.test('consulta sin filtros y oculta baja calidad', async () => {
        const { response, body } = await apiRequest('/api/plans');
        assert.equal(response.status, 200);
        assert.equal(body.pagination.total, 3);
        assert.equal(body.pagination.page, 1);
        assert.ok(body.data.every(({ quality_score }) => quality_score >= 35));
      });

      await context.test('oculta caducados, ubicaciones externas y fechas inválidas incluso por id', async () => {
        const expired = await apiRequest(`/api/plans/${ids.expired}`);
        const outside = await apiRequest(`/api/plans/${ids.outsideCatalonia}`);
        const temporallyInvalid = await apiRequest(`/api/plans/${ids.temporallyInvalid}`);
        assert.equal(expired.response.status, 404);
        assert.equal(outside.response.status, 404);
        assert.equal(temporallyInvalid.response.status, 404);
      });

      await context.test('filtra por comarca', async () => {
        const { body } = await apiRequest('/api/plans?comarca=Baix%20Emporda');
        assert.equal(body.pagination.total, 2);
        assert.ok(body.data.every(({ comarca }) => comarca === 'Baix Emporda'));
      });

      await context.test('filtra por municipio', async () => {
        const { body } = await apiRequest('/api/plans?municipality=Palafrugell');
        assert.equal(body.pagination.total, 1);
        assert.equal(body.data[0].id, ids.event);
      });

      await context.test('el municipio prevalece sobre comarca para fuentes sin comarca', async () => {
        const { body } = await apiRequest('/api/plans?comarca=Comarca%20incorrecta&municipality=Palafrugell');
        assert.equal(body.pagination.total, 1);
        assert.equal(body.data[0].id, ids.event);
      });

      await context.test('normaliza acentos al filtrar por municipio', async () => {
        db.prepare('UPDATE plans SET municipality = ? WHERE id = ?').run('Palafrug\u00e8ll', ids.event);
        const { body } = await apiRequest('/api/plans?municipality=Palafrugell');
        assert.equal(body.pagination.total, 1);
        assert.equal(body.data[0].id, ids.event);
        db.prepare('UPDATE plans SET municipality = ? WHERE id = ?').run('Palafrugell', ids.event);
      });

      await context.test('combina evento activo y plan permanente al filtrar por fecha', async () => {
        const { body } = await apiRequest('/api/plans?date=2026-08-20&sort=date');
        assert.equal(body.pagination.total, 2);
        assert.deepEqual(new Set(body.data.map(({ id }) => id)), new Set([ids.event, ids.permanent]));
        assert.equal(body.data[0].id, ids.event);
      });

      await context.test('filtra por intervalo de fechas', async () => {
        const { body } = await apiRequest('/api/plans?dateFrom=2026-08-21&dateTo=2026-08-23');
        assert.deepEqual(new Set(body.data.map(({ id }) => id)), new Set([ids.translatedEvent, ids.permanent]));
      });

      await context.test('filtra actividades gratuitas', async () => {
        const { body } = await apiRequest('/api/plans?free=true');
        assert.equal(body.pagination.total, 1);
        assert.equal(body.data[0].free, true);
      });

      await context.test('filtra por categoría', async () => {
        const { body } = await apiRequest('/api/plans?category=musica');
        assert.equal(body.pagination.total, 1);
        assert.equal(body.data[0].id, ids.event);
      });

      await context.test('combina provincia, características y tipo', async () => {
        const { body } = await apiRequest(
          '/api/plans?province=Barcelona&family=false&indoor=true&outdoor=false&kind=event',
        );
        assert.equal(body.pagination.total, 1);
        assert.equal(body.data[0].id, ids.translatedEvent);
      });

      await context.test('ordena por calidad y título', async () => {
        const quality = await apiRequest('/api/plans?sort=quality&limit=1');
        assert.equal(quality.body.data[0].id, ids.translatedEvent);
        const title = await apiRequest('/api/plans?sort=title&limit=1');
        assert.equal(title.body.data[0].title, 'Concert català');
      });

      await context.test('pagina los resultados', async () => {
        const { body } = await apiRequest('/api/plans?page=2&limit=1');
        assert.equal(body.data.length, 1);
        assert.deepEqual(body.pagination, { page: 2, limit: 1, total: 3, pages: 3 });
      });

      await context.test('acepta limit 100 y rechaza valores superiores', async () => {
        assert.equal((await apiRequest('/api/plans?limit=100')).response.status, 200);
        const invalid = await apiRequest('/api/plans?limit=101');
        assert.equal(invalid.response.status, 400);
        assert.match(invalid.body.error.message, /entre 1 i 100/);
      });

      await context.test('rechaza parámetros inválidos y desconocidos', async () => {
        assert.equal((await apiRequest('/api/plans?date=2026-02-30')).response.status, 400);
        assert.equal((await apiRequest('/api/plans?family=maybe')).response.status, 400);
        assert.equal((await apiRequest('/api/plans?distance=10')).response.status, 400);
        assert.equal((await apiRequest('/api/plans?lang=en')).response.status, 400);
      });

      await context.test('usa castellano y conserva el original si falta traducción', async () => {
        const translated = await apiRequest('/api/plans?municipality=Barcelona&lang=es');
        assert.equal(translated.body.data[0].title, 'Exposición temporal');
        const fallback = await apiRequest('/api/plans?municipality=Palafrugell&lang=es');
        assert.equal(fallback.body.data[0].title, 'Concert original català');
      });

      await context.test('devuelve el detalle completo y su atribución', async () => {
        const { response, body } = await apiRequest(`/api/plans/${ids.event}?lang=ca`);
        assert.equal(response.status, 200);
        assert.equal(body.data.title, 'Concert català');
        assert.equal(body.data.description, 'Descripció catalana');
        assert.equal(body.data.venue_name, 'Plaça Nova');
        assert.equal(body.data.categories[0].slug, 'musica');
        assert.equal(body.data.sources[0].name, 'Agenda Cultural de Catalunya');
        assert.equal(body.data.sources[0].publisher, 'Generalitat de Catalunya. Departament de Cultura');
        assert.equal(body.data.sources[0].attribution_text, 'Generalitat de Catalunya. Departament de Cultura');
        assert.equal(body.data.sources[0].source_updated_at, '2026-08-17T08:00:00.000Z');
        assert.equal(body.data.sources[0].imported_at, '2026-08-17T09:00:00.000Z');
      });

      await context.test('lista comarcas, municipios filtrados y categorías', async () => {
        const comarques = await apiRequest('/api/comarques');
        assert.deepEqual(comarques.body.data, ['Baix Emporda', 'Barcelones']);
        const municipalities = await apiRequest('/api/municipalities?comarca=Baix%20Emporda');
        assert.deepEqual(municipalities.body.data, ['Begur', 'Palafrugell']);
        const categories = await apiRequest('/api/categories');
        assert.ok(categories.body.data.some((category) => (
          category.slug === 'musica'
          && category.name_ca === 'Música'
          && category.name_es === 'Música'
          && 'icon' in category
          && 'group_name' in category
        )));
      });

      await context.test('expone los registros legales existentes de fuentes activas', async () => {
        const sources = await apiRequest('/api/sources');
        assert.equal(sources.response.status, 200);
        assert.equal(sources.body.data.length, 2);
        const gencat = sources.body.data.find(({ name }) => name === 'Agenda Cultural de Catalunya');
        const ticketmaster = sources.body.data.find(({ name }) => name === 'Ticketmaster Discovery Feed España');
        assert.ok(gencat);
        assert.ok(ticketmaster);
        assert.equal(
          gencat.attribution_text,
          'Generalitat de Catalunya. Departament de Cultura',
        );
        assert.match(gencat.license_url, /^https:\/\//);
        assert.match(ticketmaster.license_url, /^https:\/\//);
      });
  });
});
