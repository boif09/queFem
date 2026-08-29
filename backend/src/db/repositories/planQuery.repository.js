import { outsideCataloniaWhere } from '../../location/cataloniaScope.js';
import {
  currentYearInCatalonia,
  temporallyInvalidWhere,
} from '../../quality/temporalCoherence.js';
import { retainedPlanWhere, retentionCutoff } from '../../retention/eventRetention.js';
import {
  activeOccurrenceDate,
  activeOccurrenceExists,
  activeOccurrencePlanIds,
  anyOccurrenceExists,
} from '../../occurrences/occurrenceSql.js';
import { normalizeFeverPrice } from '../../fever/publicationPolicy.js';

const QUALITY_THRESHOLD = 35;

function localizedExpressions(language) {
  if (language === 'es') {
    return {
      title: "COALESCE(NULLIF(p.title_es, ''), NULLIF(p.original_title, ''), NULLIF(p.title_ca, ''))",
      subtitle: "COALESCE(NULLIF(p.subtitle_es, ''), NULLIF(p.subtitle_ca, ''))",
      description: "COALESCE(NULLIF(p.description_es, ''), NULLIF(p.original_description, ''), NULLIF(p.description_ca, ''))",
    };
  }
  return {
    title: "COALESCE(NULLIF(p.title_ca, ''), NULLIF(p.original_title, ''), NULLIF(p.title_es, ''))",
    subtitle: "COALESCE(NULLIF(p.subtitle_ca, ''), NULLIF(p.subtitle_es, ''))",
    description: "COALESCE(NULLIF(p.description_ca, ''), NULLIF(p.original_description, ''), NULLIF(p.description_es, ''))",
  };
}

function toNullableBoolean(value) {
  return value === null || value === undefined ? null : value === 1;
}

function mapPlan(row) {
  const plan = {
    ...row,
    permanent: row.permanent === 1,
    free: toNullableBoolean(row.is_free),
    family: toNullableBoolean(row.family_friendly),
    indoor: toNullableBoolean(row.indoor),
    outdoor: toNullableBoolean(row.outdoor),
    featured: row.featured === 1,
    image_reuse_allowed: row.image_reuse_allowed === 1,
    image_url: row.image_reuse_allowed === 1 ? row.image_url : null,
  };
  if (row.next_occurrence) {
    const [localDate, localTime] = row.next_occurrence.split('\u001f');
    plan.nextOccurrence = { localDate, localTime: localTime || null };
  }
  delete plan.next_occurrence;
  return plan;
}

export class PlanQueryRepository {
  constructor(db, {
    eventRetentionDays = 0,
    now = () => new Date(),
    ticketmasterImagesEnabled = false,
    feverImagesEnabled = false,
    fallbackImageLibrary = null,
  } = {}) {
    this.db = db;
    this.eventRetentionDays = eventRetentionDays;
    this.now = now;
    this.ticketmasterImagesEnabled = ticketmasterImagesEnabled;
    this.feverImagesEnabled = feverImagesEnabled;
    this.fallbackImageLibrary = fallbackImageLibrary;
  }

  visiblePlanConditions(alias = 'p') {
    const now = this.now();
    return {
      clauses: [
        `${alias}.status = 'active'`,
        `EXISTS (
          SELECT 1 FROM plan_sources visibility_ps
          JOIN sources visibility_s ON visibility_s.id = visibility_ps.source_id
          WHERE visibility_ps.plan_id = ${alias}.id AND visibility_s.enabled = 1
        )`,
        `(${activeOccurrenceExists(alias, '', { enabledOnly: true })} OR NOT (${anyOccurrenceExists(alias, { enabledOnly: true })}))`,
        `${alias}.quality_score >= ?`,
        retainedPlanWhere(alias, { enabledOnly: true }),
        `NOT (${outsideCataloniaWhere(alias)})`,
        `NOT (${temporallyInvalidWhere(alias, { enabledOnly: true })})`,
      ],
      parameters: [
        QUALITY_THRESHOLD,
        retentionCutoff(this.eventRetentionDays, now),
        currentYearInCatalonia(now),
      ],
    };
  }

  buildWhere(filters) {
    const { clauses, parameters } = this.visiblePlanConditions();
    if (filters.q !== undefined) {
      clauses.push(`(
        instr(normalize_location(p.original_title), normalize_location(?)) > 0 OR
        instr(normalize_location(p.title_ca), normalize_location(?)) > 0 OR
        instr(normalize_location(p.title_es), normalize_location(?)) > 0 OR
        instr(normalize_location(p.venue_name), normalize_location(?)) > 0
      )`);
      parameters.push(filters.q, filters.q, filters.q, filters.q);
    }
    const equalFilters = [
      ['province', 'p.province'],
      ['kind', 'p.kind'],
    ];
    if (filters.municipality !== undefined) {
      clauses.push('normalize_location(p.municipality) = normalize_location(?)');
      parameters.push(filters.municipality);
    }
    if (filters.comarca !== undefined) {
      clauses.push('normalize_location(p.comarca) = normalize_location(?)');
      parameters.push(filters.comarca);
    }
    for (const [key, column] of equalFilters) {
      if (filters[key] !== undefined) {
        clauses.push(`${column} = ? COLLATE NOCASE`);
        parameters.push(filters[key]);
      }
    }

    const booleanFilters = [
      ['free', 'p.is_free'],
      ['family', 'p.family_friendly'],
      ['indoor', 'p.indoor'],
      ['outdoor', 'p.outdoor'],
      ['permanent', 'p.permanent'],
    ];
    for (const [key, column] of booleanFilters) {
      if (filters[key] !== undefined) {
        clauses.push(`${column} = ?`);
        parameters.push(filters[key]);
      }
    }

    if (filters.categories?.length) {
      clauses.push(`p.id IN (
        SELECT pc_filter.plan_id FROM plan_categories pc_filter
        JOIN categories c_filter ON c_filter.id = pc_filter.category_id
        WHERE c_filter.slug IN (${filters.categories.map(() => '?').join(', ')})
      )`);
      parameters.push(...filters.categories);
    }

    const hasAnyOccurrences = anyOccurrenceExists('p', { enabledOnly: true });
    if (filters.editorial === 'home-upcoming') {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
        OR (NOT (${hasAnyOccurrences}) AND p.start_date IS NOT NULL AND p.start_date >= ?)
      )`);
      parameters.push(filters.dateFrom, filters.dateFrom);
    } else if (filters.date) {
      clauses.push(`(
        ${activeOccurrencePlanIds('AND occurrence_o.local_date = ?', { enabledOnly: true })}
        OR (NOT (${hasAnyOccurrences}) AND (
          p.permanent = 1 OR
          (p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date <= ? AND p.end_date >= ?)
        ))
      )`);
      parameters.push(filters.date, filters.date, filters.date);
    } else if (filters.dateFrom && filters.dateTo) {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: true })}
        OR (NOT (${hasAnyOccurrences}) AND (
          p.permanent = 1 OR
          (p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date <= ? AND p.end_date >= ?)
        ))
      )`);
      parameters.push(filters.dateFrom, filters.dateTo, filters.dateTo, filters.dateFrom);
    } else if (filters.dateFrom) {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
        OR (NOT (${hasAnyOccurrences}) AND (p.permanent = 1 OR (p.end_date IS NOT NULL AND p.end_date >= ?)))
      )`);
      parameters.push(filters.dateFrom, filters.dateFrom);
    } else if (filters.dateTo) {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date <= ?', { enabledOnly: true })}
        OR (NOT (${hasAnyOccurrences}) AND (p.permanent = 1 OR (p.start_date IS NOT NULL AND p.start_date <= ?)))
      )`);
      parameters.push(filters.dateTo, filters.dateTo);
    }

    return { sql: clauses.join(' AND '), parameters };
  }

  findMany(filters) {
    const text = localizedExpressions(filters.lang);
    const where = this.buildWhere(filters);
    let orderBy;
    let orderParameters = [];
    const hasAnyOccurrences = anyOccurrenceExists('p', { enabledOnly: true });
    if (filters.editorial === 'home-weekend') {
      orderBy = `
        CASE WHEN ${hasAnyOccurrences} THEN 0 WHEN p.start_date BETWEEN ? AND ? THEN 0 ELSE 1 END ASC,
        CASE
          WHEN ${hasAnyOccurrences} THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: true })}
          WHEN p.start_date BETWEEN ? AND ? THEN p.start_date
        END ASC,
        CASE WHEN NOT (${hasAnyOccurrences}) AND p.start_date < ? THEN p.start_date END DESC,
        p.id ASC
      `;
      orderParameters = [
        filters.dateFrom, filters.dateTo,
        filters.dateFrom, filters.dateTo,
        filters.dateFrom, filters.dateTo, filters.dateFrom,
      ];
    } else if (filters.editorial === 'home-upcoming') {
      orderBy = `CASE WHEN ${hasAnyOccurrences}
        THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
        ELSE p.start_date END ASC, p.id ASC`;
      orderParameters = [filters.dateFrom];
    } else if (filters.dateFrom && filters.dateTo) {
      const rangeOccurrenceExists = activeOccurrenceExists(
        'p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: true },
      );
      const rangeOccurrenceDate = activeOccurrenceDate(
        'p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: true },
      );
      const rangeTier = `CASE
        WHEN p.start_date BETWEEN ? AND ? THEN 0
        WHEN ${rangeOccurrenceExists} THEN 1
        ELSE 2
      END ASC`;
      const rangeTemporalOrder = `CASE
        WHEN p.start_date BETWEEN ? AND ? THEN p.start_date
        WHEN ${rangeOccurrenceExists} THEN ${rangeOccurrenceDate}
        ELSE p.start_date
      END ASC`;
      orderBy = {
        date: `${rangeTier}, p.permanent ASC, ${rangeTemporalOrder}, p.id ASC`,
        quality: `${rangeTier}, p.quality_score DESC, p.permanent ASC, ${rangeTemporalOrder}, p.id ASC`,
        title: `${rangeTier}, ${text.title} COLLATE NOCASE ASC, p.id ASC`,
      }[filters.sort];
      orderParameters = filters.sort === 'title'
        ? [filters.dateFrom, filters.dateTo, filters.dateFrom, filters.dateTo]
        : [
          filters.dateFrom, filters.dateTo, filters.dateFrom, filters.dateTo,
          filters.dateFrom, filters.dateTo, filters.dateFrom, filters.dateTo,
          filters.dateFrom, filters.dateTo,
        ];
    } else {
      const dateOrder = filters.date
        ? `CASE
            WHEN ${hasAnyOccurrences} THEN 0
            WHEN p.permanent = 0 AND p.start_date = ? THEN 0
            WHEN p.permanent = 0 THEN 1
            ELSE 2
          END,
          CASE WHEN ${hasAnyOccurrences} THEN ? ELSE p.start_date END DESC,
          p.id ASC`
        : `p.permanent ASC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
            ELSE p.start_date END IS NULL ASC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
            ELSE p.start_date END ASC,
          p.id ASC`;
      const today = retentionCutoff(0, this.now());
      orderBy = {
        date: dateOrder,
        quality: `p.quality_score DESC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
            ELSE p.start_date END IS NULL ASC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: true })}
            ELSE p.start_date END ASC,
          p.id ASC`,
        title: `${text.title} COLLATE NOCASE ASC, p.id ASC`,
      }[filters.sort];
      if (filters.sort === 'date') {
        orderParameters = filters.date ? [filters.date, filters.date] : [today, today];
      } else if (filters.sort === 'quality') orderParameters = [today, today];
    }

    const total = this.db.prepare(`SELECT COUNT(*) AS total FROM plans p WHERE ${where.sql}`)
      .get(...where.parameters).total;
    const offset = (filters.page - 1) * filters.limit;
    const rows = this.db.prepare(`
      SELECT
        p.id, p.fingerprint, p.kind, p.original_language,
        ${text.title} AS title,
        ${text.subtitle} AS subtitle,
        ${text.description} AS description,
        p.start_date, p.end_date, p.schedule_text, p.permanent,
        p.price_text, p.is_free, p.province, p.comarca, p.municipality,
        p.locality, p.address, p.postal_code, p.venue_name,
        p.latitude, p.longitude, p.website_url, p.ticket_url,
        p.image_url, p.image_reuse_allowed, p.family_friendly,
        p.indoor, p.outdoor, p.featured, p.quality_score,
        (SELECT o.local_date || char(31) || COALESCE(o.local_time, '')
          FROM plan_occurrences o JOIN plan_sources ops ON ops.id=o.plan_source_id JOIN sources os ON os.id=ops.source_id
          WHERE ops.plan_id=p.id AND os.enabled=1 AND o.status='active' AND o.local_date>=? ORDER BY o.local_date,o.local_time LIMIT 1) next_occurrence
      FROM plans p
      WHERE ${where.sql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(retentionCutoff(0, this.now()), ...where.parameters, ...orderParameters, filters.limit, offset);

    const plans = rows.map(mapPlan);
    this.attachCategories(plans, filters.lang);
    this.attachImages(plans, 'card', filters.lang);
    this.attachCommerce(plans);
    for (const plan of plans) delete plan.fingerprint;
    return { plans, total };
  }

  attachCommerce(plans) {
    if (!plans.length) return;
    const placeholders = plans.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT ps.plan_id,ps.source_url,ps.source_payload_json
      FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
      WHERE ps.plan_id IN (${placeholders}) AND s.key='fever' AND s.enabled=1`).all(...plans.map(({ id }) => id));
    const byPlan = new Map(rows.map((row) => {
      const payload = JSON.parse(row.source_payload_json);
      return [row.plan_id, { provider: 'fever', affiliateUrl: row.source_url,
        price: normalizeFeverPrice(payload.CurrentPrice, payload.Currency, payload.Labels) }];
    }));
    for (const plan of plans) if (byPlan.has(plan.id)) plan.commerce = byPlan.get(plan.id);
  }

  attachImages(plans, role, language = 'ca') {
    for (const plan of plans) plan.image = null;
    if (plans.length === 0) return;
    const placeholders = plans.map(() => '?').join(', ');
    const rows = (!this.ticketmasterImagesEnabled && !this.feverImagesEnabled) ? [] : this.db.prepare(`
      SELECT plan_id, image_id, width, height, attribution, source_key
      FROM (
        SELECT
          ps.plan_id, psi.id image_id,
          CASE WHEN psi.ratio='unknown' THEN NULL ELSE psi.width END width,
          CASE WHEN psi.ratio='unknown' THEN NULL ELSE psi.height END height,
          psi.attribution,
          CASE WHEN s.key='fever' THEN 'fever' ELSE 'ticketmaster' END source_key,
          ROW_NUMBER() OVER (
            PARTITION BY ps.plan_id
            ORDER BY psi.is_fallback ASC, psi.last_seen_at DESC, psi.id ASC
          ) image_rank
        FROM plan_source_images psi
        JOIN plan_sources ps ON ps.id = psi.plan_source_id
        JOIN sources s ON s.id = ps.source_id
        WHERE ps.plan_id IN (${placeholders})
          AND psi.role = ?
          AND ((s.key = 'ticketmaster-discovery-feed' AND ? = 1) OR (s.key = 'fever' AND ? = 1))
          AND s.enabled = 1
      ) ranked
      WHERE image_rank = 1
    `).all(...plans.map(({ id }) => id), role, Number(this.ticketmasterImagesEnabled), Number(this.feverImagesEnabled));
    const byPlan = new Map(rows.map((row) => [row.plan_id, {
      url: `/api/media/${row.source_key || 'ticketmaster'}/${row.image_id}`,
      kind: 'official',
      width: row.width,
      height: row.height,
      ...(row.attribution ? { attribution: row.attribution } : {}),
      source: row.source_key || 'ticketmaster',
    }]));
    for (const plan of plans) {
      plan.image = byPlan.get(plan.id) || this.fallbackImageLibrary?.resolve(plan, { role, language }) || null;
    }
  }

  attachCategories(plans, language) {
    if (plans.length === 0) return;
    const placeholders = plans.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT pc.plan_id, c.slug, c.name_ca, c.name_es, c.icon, c.group_name
      FROM plan_categories pc
      JOIN categories c ON c.id = pc.category_id
      WHERE pc.plan_id IN (${placeholders})
      ORDER BY c.slug
    `).all(...plans.map(({ id }) => id));
    const byPlan = new Map(plans.map(({ id }) => [id, []]));
    for (const row of rows) {
      byPlan.get(row.plan_id).push({
        slug: row.slug,
        name: language === 'es' ? (row.name_es || row.name_ca) : (row.name_ca || row.name_es),
        name_ca: row.name_ca,
        name_es: row.name_es,
        icon: row.icon,
        group_name: row.group_name,
      });
    }
    for (const plan of plans) plan.categories = byPlan.get(plan.id);
  }

  findById(id, language) {
    const text = localizedExpressions(language);
    const visible = this.visiblePlanConditions();
    const row = this.db.prepare(`
      SELECT p.*, ${text.title} AS title, ${text.subtitle} AS subtitle, ${text.description} AS description
      FROM plans p
      WHERE p.id = ? AND ${visible.clauses.join(' AND ')}
    `).get(id, ...visible.parameters);
    if (!row) return null;

    const plan = mapPlan(row);
    delete plan.is_free;
    delete plan.family_friendly;
    this.attachCategories([plan], language);
    this.attachImages([plan], 'detail', language);
    delete plan.fingerprint;
    const today = retentionCutoff(0, this.now());
    plan.nextOccurrences = this.db.prepare(`SELECT o.local_date localDate,o.local_time localTime
      FROM plan_occurrences o JOIN plan_sources ps ON ps.id=o.plan_source_id JOIN sources s ON s.id=ps.source_id
      WHERE ps.plan_id=? AND s.enabled=1 AND o.status='active' AND o.local_date>=?
      ORDER BY o.local_date,o.local_time LIMIT 11`).all(id, today);
    plan.hasMoreOccurrences = plan.nextOccurrences.length > 10;
    if (plan.hasMoreOccurrences) plan.nextOccurrences.pop();
    plan.nextOccurrence = plan.nextOccurrences[0] || null;
    const fever = this.db.prepare(`SELECT ps.source_url,ps.source_payload_json FROM plan_sources ps
      JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? AND s.key='fever' AND s.enabled=1`).get(id);
    if (fever) {
      const payload = JSON.parse(fever.source_payload_json);
      plan.commerce = { provider: 'fever', affiliateUrl: fever.source_url,
        price: normalizeFeverPrice(payload.CurrentPrice, payload.Currency, payload.Labels) };
    }
    plan.sources = this.db.prepare(`
      SELECT
        s.name, s.publisher, ps.source_url, s.attribution_text,
        s.license_name, s.license_url, ps.source_updated_at, ps.imported_at
      FROM plan_sources ps
      JOIN sources s ON s.id = ps.source_id
      WHERE ps.plan_id = ? AND s.enabled = 1
      ORDER BY s.name, ps.source_updated_at DESC, ps.imported_at DESC
    `).all(id);
    return plan;
  }

  findProvinces() {
    const visible = this.visiblePlanConditions('plans');
    return this.db.prepare(`
      SELECT DISTINCT province
      FROM plans
      WHERE ${visible.clauses.join(' AND ')}
        AND province IS NOT NULL AND trim(province) <> ''
      ORDER BY province COLLATE NOCASE
    `).all(...visible.parameters).map(({ province }) => province);
  }

  findComarques(province) {
    const visible = this.visiblePlanConditions('plans');
    const conditions = [
      ...visible.clauses, "comarca IS NOT NULL", "trim(comarca) <> ''",
    ];
    const parameters = [...visible.parameters];
    if (province) {
      conditions.push('province = ? COLLATE NOCASE');
      parameters.push(province);
    }
    return this.db.prepare(`
      SELECT comarca, MIN(province) province
      FROM plans
      WHERE ${conditions.join(' AND ')}
      GROUP BY comarca COLLATE NOCASE
      ORDER BY comarca COLLATE NOCASE
    `).all(...parameters);
  }

  findMunicipalities({ province, comarca } = {}) {
    const visible = this.visiblePlanConditions('plans');
    const conditions = [
      ...visible.clauses, "municipality IS NOT NULL", "trim(municipality) <> ''",
    ];
    const parameters = [...visible.parameters];
    if (province) {
      conditions.push('province = ? COLLATE NOCASE');
      parameters.push(province);
    }
    if (comarca) {
      conditions.push('comarca = ? COLLATE NOCASE');
      parameters.push(comarca);
    }
    return this.db.prepare(`
      SELECT municipality, MIN(comarca) comarca, MIN(province) province
      FROM plans
      WHERE ${conditions.join(' AND ')}
      GROUP BY municipality COLLATE NOCASE
      ORDER BY municipality COLLATE NOCASE
    `).all(...parameters);
  }

  findCategories() {
    return this.db.prepare(`
      SELECT slug, name_ca, name_es, icon, group_name FROM categories ORDER BY slug
    `).all();
  }

  findSources() {
    return this.db.prepare(`
      SELECT
        key, name, publisher, dataset_name, dataset_url,
        license_name, license_url, attribution_text, reviewed_at
      FROM sources
      WHERE enabled = 1
      ORDER BY name COLLATE NOCASE
    `).all();
  }

  findSitemapPlanIds() {
    const visible = this.visiblePlanConditions();
    return this.db.prepare(`
      SELECT p.id
      FROM plans p
      WHERE ${visible.clauses.join(' AND ')}
        AND p.kind = 'event'
      ORDER BY p.id
    `).all(...visible.parameters).map(({ id }) => id);
  }
}
