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
import { boundingBox } from '../../location/distance.js';

const QUALITY_THRESHOLD = 35;

function occurrenceScope(syndicatedOnly) {
  return syndicatedOnly ? 'syndicated' : true;
}

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
    gencatImagesEnabled = true,
    fallbackImageLibrary = null,
  } = {}) {
    this.db = db;
    this.eventRetentionDays = eventRetentionDays;
    this.now = now;
    this.ticketmasterImagesEnabled = ticketmasterImagesEnabled;
    this.feverImagesEnabled = feverImagesEnabled;
    this.gencatImagesEnabled = gencatImagesEnabled;
    this.fallbackImageLibrary = fallbackImageLibrary;
  }

  // syndicatedOnly (embed widget): occurrences from non-syndicable sources such as Fever or
  // Ticketmaster must neither make a plan visible nor supply its dates.
  visiblePlanConditions(alias = 'p', { syndicatedOnly = false } = {}) {
    const scope = occurrenceScope(syndicatedOnly);
    const now = this.now();
    return {
      clauses: [
        `${alias}.status = 'active'`,
        `EXISTS (
          SELECT 1 FROM plan_sources visibility_ps
          JOIN sources visibility_s ON visibility_s.id = visibility_ps.source_id
          WHERE visibility_ps.plan_id = ${alias}.id AND visibility_s.enabled = 1
        )`,
        `(${activeOccurrenceExists(alias, '', { enabledOnly: scope })} OR NOT (${anyOccurrenceExists(alias, { enabledOnly: scope })}))`,
        `${alias}.quality_score >= ?`,
        retainedPlanWhere(alias, { enabledOnly: scope }),
        `NOT (${outsideCataloniaWhere(alias)})`,
        `NOT (${temporallyInvalidWhere(alias, { enabledOnly: scope })})`,
      ],
      parameters: [
        QUALITY_THRESHOLD,
        retentionCutoff(this.eventRetentionDays, now),
        currentYearInCatalonia(now),
      ],
    };
  }

  buildWhere(filters) {
    const scope = occurrenceScope(filters.syndicatedOnly);
    const { clauses, parameters } = this.visiblePlanConditions('p', { syndicatedOnly: Boolean(filters.syndicatedOnly) });
    // Internal only (embed widget): never reachable from validatePlansQuery.
    if (filters.syndicatedOnly) {
      clauses.push(`EXISTS (
        SELECT 1 FROM plan_sources syndication_ps
        JOIN sources syndication_s ON syndication_s.id = syndication_ps.source_id
        WHERE syndication_ps.plan_id = p.id AND syndication_s.enabled = 1 AND syndication_s.allows_syndication = 1
      )`);
    }
    // Internal only (embed widget): plans within radiusKm of a point; plans without coordinates are excluded.
    if (filters.near) {
      const { latitude, longitude, radiusKm } = filters.near;
      const box = boundingBox(latitude, longitude, radiusKm);
      clauses.push(`p.latitude BETWEEN ? AND ? AND p.longitude BETWEEN ? AND ?
        AND distance_km(p.latitude, p.longitude, ?, ?) <= ?`);
      parameters.push(box.minLatitude, box.maxLatitude, box.minLongitude, box.maxLongitude, latitude, longitude, radiusKm);
    }
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

    const hasAnyOccurrences = anyOccurrenceExists('p', { enabledOnly: scope });
    if (filters.editorial === 'home-upcoming') {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
        OR (NOT (${hasAnyOccurrences}) AND p.start_date IS NOT NULL AND p.start_date >= ?)
      )`);
      parameters.push(filters.dateFrom, filters.dateFrom);
    } else if (filters.date) {
      clauses.push(`(
        ${activeOccurrencePlanIds('AND occurrence_o.local_date = ?', { enabledOnly: scope })}
        OR (NOT (${hasAnyOccurrences}) AND (
          p.permanent = 1 OR
          (p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date <= ? AND p.end_date >= ?)
        ))
      )`);
      parameters.push(filters.date, filters.date, filters.date);
    } else if (filters.dateFrom && filters.dateTo) {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: scope })}
        OR (NOT (${hasAnyOccurrences}) AND (
          p.permanent = 1 OR
          (p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date <= ? AND p.end_date >= ?)
        ))
      )`);
      parameters.push(filters.dateFrom, filters.dateTo, filters.dateTo, filters.dateFrom);
    } else if (filters.dateFrom) {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
        OR (NOT (${hasAnyOccurrences}) AND (p.permanent = 1 OR (p.end_date IS NOT NULL AND p.end_date >= ?)))
      )`);
      parameters.push(filters.dateFrom, filters.dateFrom);
    } else if (filters.dateTo) {
      clauses.push(`(
        ${activeOccurrenceExists('p', 'AND occurrence_o.local_date <= ?', { enabledOnly: scope })}
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
    const scope = occurrenceScope(filters.syndicatedOnly);
    const hasAnyOccurrences = anyOccurrenceExists('p', { enabledOnly: scope });
    if (filters.editorial === 'home-weekend') {
      orderBy = `
        CASE WHEN ${hasAnyOccurrences} THEN 0 WHEN p.start_date BETWEEN ? AND ? THEN 0 ELSE 1 END ASC,
        CASE
          WHEN ${hasAnyOccurrences} THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: scope })}
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
        THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
        ELSE p.start_date END ASC, p.id ASC`;
      orderParameters = [filters.dateFrom];
    } else if (filters.dateFrom && filters.dateTo) {
      const rangeOccurrenceExists = activeOccurrenceExists(
        'p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: scope },
      );
      const rangeOccurrenceDate = activeOccurrenceDate(
        'p', 'AND occurrence_o.local_date BETWEEN ? AND ?', { enabledOnly: scope },
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
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
            ELSE p.start_date END IS NULL ASC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
            ELSE p.start_date END ASC,
          p.id ASC`;
      const today = retentionCutoff(0, this.now());
      orderBy = {
        date: dateOrder,
        quality: `p.quality_score DESC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
            ELSE p.start_date END IS NULL ASC,
          CASE WHEN ${hasAnyOccurrences}
            THEN ${activeOccurrenceDate('p', 'AND occurrence_o.local_date >= ?', { enabledOnly: scope })}
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
          WHERE ops.plan_id=p.id AND os.enabled=1 ${filters.syndicatedOnly ? 'AND os.allows_syndication=1' : ''} AND o.status='active' AND o.local_date>=? ORDER BY o.local_date,o.local_time LIMIT 1) next_occurrence
      FROM plans p
      WHERE ${where.sql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(retentionCutoff(0, this.now()), ...where.parameters, ...orderParameters, filters.limit, offset);

    const plans = rows.map(mapPlan);
    this.attachCategories(plans, filters.lang);
    this.attachImages(plans, 'card', filters.lang, { syndicatedOnly: Boolean(filters.syndicatedOnly) });
    // Affiliate commerce belongs to tenspla.cat; it is never syndicated to third-party sites.
    if (!filters.syndicatedOnly) this.attachCommerce(plans);
    for (const plan of plans) delete plan.fingerprint;
    return { plans, total };
  }

  syndicationAttributions(planIds) {
    if (!planIds.length) return [];
    return this.db.prepare(`SELECT DISTINCT s.attribution_text
      FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE ps.plan_id IN (${planIds.map(() => '?').join(', ')})
        AND s.enabled = 1 AND s.allows_syndication = 1 AND s.attribution_text IS NOT NULL
      ORDER BY s.attribution_text`).pluck().all(...planIds);
  }

  latestSyndicatedImportAt() {
    return this.db.prepare(`SELECT MAX(r.finished_at) FROM import_runs r
      JOIN sources s ON s.id = r.source_id
      WHERE r.status = 'completed' AND s.enabled = 1 AND s.allows_syndication = 1`).pluck().get() || null;
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

  attachImages(plans, role, language = 'ca', { syndicatedOnly = false } = {}) {
    for (const plan of plans) plan.image = null;
    if (plans.length === 0) return;
    const placeholders = plans.map(() => '?').join(', ');
    const rows = (!this.ticketmasterImagesEnabled && !this.feverImagesEnabled && !this.gencatImagesEnabled) ? [] : this.db.prepare(`
      SELECT plan_id, image_id, width, height, attribution, source_key
      FROM (
        SELECT
          ps.plan_id, psi.id image_id,
          CASE WHEN psi.ratio='unknown' THEN NULL ELSE psi.width END width,
          CASE WHEN psi.ratio='unknown' THEN NULL ELSE psi.height END height,
          psi.attribution,
          CASE
            WHEN s.key = 'fever' THEN 'fever'
            WHEN s.key = 'gencat-agenda' THEN 'gencat'
            ELSE 'ticketmaster'
          END source_key,
          ROW_NUMBER() OVER (
            PARTITION BY ps.plan_id
            ORDER BY
              CASE WHEN s.key IN ('ticketmaster-discovery-feed', 'fever') THEN 0 ELSE 1 END,
              psi.is_fallback ASC, psi.last_seen_at DESC, psi.id ASC
          ) image_rank
        FROM plan_source_images psi
        JOIN plan_sources ps ON ps.id = psi.plan_source_id
        JOIN sources s ON s.id = ps.source_id
        WHERE ps.plan_id IN (${placeholders})
          AND psi.role = ?
          AND psi.attribution_known = 1
          AND (s.key <> 'gencat-agenda' OR s.allows_images = 1)
          AND ((s.key = 'ticketmaster-discovery-feed' AND ? = 1)
            OR (s.key = 'fever' AND ? = 1)
            OR (s.key = 'gencat-agenda' AND ? = 1))
          AND s.enabled = 1
          AND (? = 0 OR s.allows_syndication = 1)
      ) ranked
      WHERE image_rank = 1
    `).all(
      ...plans.map(({ id }) => id), role,
      Number(this.ticketmasterImagesEnabled), Number(this.feverImagesEnabled), Number(this.gencatImagesEnabled),
      Number(syndicatedOnly),
    );
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
    const fever = this.db.prepare(`SELECT ps.source_url,ps.source_record_id,ps.source_payload_json FROM plan_sources ps
      JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? AND s.key='fever' AND s.enabled=1`).get(id);
    if (fever) {
      const payload = JSON.parse(fever.source_payload_json);
      plan.commerce = { provider: 'fever', affiliateUrl: fever.source_url, sourceRecordId: fever.source_record_id,
        price: normalizeFeverPrice(payload.CurrentPrice, payload.Currency, payload.Labels) };
    }
    const rawSources = this.db.prepare(`
      SELECT
        s.name, s.publisher, ps.source_url, s.attribution_text,
        s.license_name, s.license_url, ps.source_updated_at, ps.imported_at
      FROM plan_sources ps
      JOIN sources s ON s.id = ps.source_id
      WHERE ps.plan_id = ? AND s.enabled = 1
      ORDER BY s.name, ps.source_updated_at DESC, ps.imported_at DESC
    `).all(id);
    const seenSourceAttributions = new Set();
    const attributionKeyPart = (value) => {
      if (value === null) return ['null'];
      if (value === undefined) return ['undefined'];
      return ['value', value];
    };
    plan.sources = rawSources.filter((source) => {
      const displayedUpdatedAt = source.source_updated_at
        ? source.source_updated_at.slice(0, 10)
        : source.source_updated_at;
      const key = JSON.stringify([
        attributionKeyPart(source.name),
        attributionKeyPart(source.publisher),
        attributionKeyPart(source.attribution_text),
        attributionKeyPart(source.source_url),
        attributionKeyPart(displayedUpdatedAt),
      ]);
      if (seenSourceAttributions.has(key)) return false;
      seenSourceAttributions.add(key);
      return true;
    });
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
    // Gencat only ever supplies a de-accented URL slug for comarca (e.g.
    // "barcelones"), which cannot be losslessly restored to the correct
    // Catalan spelling ("Barcelonès") at import time — other sources (Fever,
    // DIBA) publish the properly accented name directly. Grouping by the raw
    // column with COLLATE NOCASE only folds case, not accents, so both
    // spellings used to survive as separate rows. normalize_location()
    // (already registered on this connection, already used by the main plan
    // filter below) folds both case and accents, matching them into one
    // group; MAX(comarca) deterministically picks the accented spelling as
    // the representative, since accented vowels always sort after their
    // unaccented counterpart under SQLite's default byte comparison.
    return this.db.prepare(`
      SELECT MAX(comarca) AS comarca, MIN(province) province
      FROM plans
      WHERE ${conditions.join(' AND ')}
      GROUP BY normalize_location(comarca)
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
      // Accent-insensitive to match findComarques()'s now-deduplicated
      // output: a comarca selected from that list must still match every
      // plan whose raw comarca column has the other (accented/unaccented)
      // spelling, not just plans matching that exact string.
      conditions.push('normalize_location(comarca) = normalize_location(?)');
      parameters.push(comarca);
    }
    return this.db.prepare(`
      SELECT municipality, MAX(comarca) comarca, MIN(province) province
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
