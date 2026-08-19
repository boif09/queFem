import { outsideCataloniaWhere } from '../../location/cataloniaScope.js';
import {
  currentYearInCatalonia,
  temporallyInvalidWhere,
} from '../../quality/temporalCoherence.js';
import { retainedPlanWhere, retentionCutoff } from '../../retention/eventRetention.js';

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
  return {
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
}

export class PlanQueryRepository {
  constructor(db, { eventRetentionDays = 0, now = () => new Date() } = {}) {
    this.db = db;
    this.eventRetentionDays = eventRetentionDays;
    this.now = now;
  }

  visiblePlanConditions(alias = 'p') {
    const now = this.now();
    return {
      clauses: [
        `${alias}.status = 'active'`,
        `${alias}.quality_score >= ?`,
        retainedPlanWhere(alias),
        `NOT (${outsideCataloniaWhere(alias)})`,
        `NOT (${temporallyInvalidWhere(alias)})`,
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
    if (filters.comarca !== undefined && filters.municipality === undefined) {
      clauses.push('p.comarca = ? COLLATE NOCASE');
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
    ];
    for (const [key, column] of booleanFilters) {
      if (filters[key] !== undefined) {
        clauses.push(`${column} = ?`);
        parameters.push(filters[key]);
      }
    }

    if (filters.category) {
      clauses.push(`p.id IN (
        SELECT pc_filter.plan_id FROM plan_categories pc_filter
        JOIN categories c_filter ON c_filter.id = pc_filter.category_id
        WHERE c_filter.slug = ?
      )`);
      parameters.push(filters.category);
    }

    if (filters.date) {
      clauses.push(`(
        p.permanent = 1 OR
        (p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date <= ? AND p.end_date >= ?)
      )`);
      parameters.push(filters.date, filters.date);
    } else if (filters.dateFrom && filters.dateTo) {
      clauses.push(`(
        p.permanent = 1 OR
        (p.start_date IS NOT NULL AND p.end_date IS NOT NULL AND p.start_date <= ? AND p.end_date >= ?)
      )`);
      parameters.push(filters.dateTo, filters.dateFrom);
    } else if (filters.dateFrom) {
      clauses.push('(p.permanent = 1 OR (p.end_date IS NOT NULL AND p.end_date >= ?))');
      parameters.push(filters.dateFrom);
    } else if (filters.dateTo) {
      clauses.push('(p.permanent = 1 OR (p.start_date IS NOT NULL AND p.start_date <= ?))');
      parameters.push(filters.dateTo);
    }

    return { sql: clauses.join(' AND '), parameters };
  }

  findMany(filters) {
    const text = localizedExpressions(filters.lang);
    const where = this.buildWhere(filters);
    const dateOrder = filters.date
      ? `CASE
          WHEN p.permanent = 0 AND p.start_date = '${filters.date}' THEN 0
          WHEN p.permanent = 0 THEN 1
          ELSE 2
        END, p.start_date DESC, p.id ASC`
      : 'p.permanent ASC, p.start_date IS NULL ASC, p.start_date ASC, p.id ASC';
    const orderBy = {
      date: dateOrder,
      quality: 'p.quality_score DESC, p.start_date IS NULL ASC, p.start_date ASC, p.id ASC',
      title: `${text.title} COLLATE NOCASE ASC, p.id ASC`,
    }[filters.sort];

    const total = this.db.prepare(`SELECT COUNT(*) AS total FROM plans p WHERE ${where.sql}`)
      .get(...where.parameters).total;
    const offset = (filters.page - 1) * filters.limit;
    const rows = this.db.prepare(`
      SELECT
        p.id, p.kind, p.original_language,
        ${text.title} AS title,
        ${text.subtitle} AS subtitle,
        ${text.description} AS description,
        p.start_date, p.end_date, p.schedule_text, p.permanent,
        p.price_text, p.is_free, p.province, p.comarca, p.municipality,
        p.locality, p.address, p.postal_code, p.venue_name,
        p.latitude, p.longitude, p.website_url, p.ticket_url,
        p.image_url, p.image_reuse_allowed, p.family_friendly,
        p.indoor, p.outdoor, p.featured, p.quality_score
      FROM plans p
      WHERE ${where.sql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...where.parameters, filters.limit, offset);

    const plans = rows.map(mapPlan);
    this.attachCategories(plans, filters.lang);
    return { plans, total };
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
    delete plan.fingerprint;
    delete plan.is_free;
    delete plan.family_friendly;
    this.attachCategories([plan], language);
    plan.sources = this.db.prepare(`
      SELECT
        s.name, s.publisher, ps.source_url, s.attribution_text,
        s.license_name, s.license_url, ps.source_updated_at, ps.imported_at
      FROM plan_sources ps
      JOIN sources s ON s.id = ps.source_id
      WHERE ps.plan_id = ?
      ORDER BY s.name, ps.source_updated_at DESC, ps.imported_at DESC
    `).all(id);
    return plan;
  }

  findComarques() {
    const visible = this.visiblePlanConditions('plans');
    return this.db.prepare(`
      SELECT DISTINCT comarca
      FROM plans
      WHERE ${visible.clauses.join(' AND ')}
        AND comarca IS NOT NULL
        AND trim(comarca) <> ''
      ORDER BY comarca COLLATE NOCASE
    `).all(...visible.parameters).map(({ comarca }) => comarca);
  }

  findMunicipalities(comarca) {
    const visible = this.visiblePlanConditions('plans');
    const conditions = [
      ...visible.clauses, "municipality IS NOT NULL", "trim(municipality) <> ''",
    ];
    const parameters = [...visible.parameters];
    if (comarca) {
      conditions.push('comarca = ? COLLATE NOCASE');
      parameters.push(comarca);
    }
    return this.db.prepare(`
      SELECT DISTINCT municipality
      FROM plans
      WHERE ${conditions.join(' AND ')}
      ORDER BY municipality COLLATE NOCASE
    `).all(...parameters).map(({ municipality }) => municipality);
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
}
