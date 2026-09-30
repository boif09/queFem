import { retentionCutoff } from '../retention/eventRetention.js';
import { OfficialPlaceNames } from './placeNames.js';

const ICGC_ATTRIBUTION = 'Institut Cartogràfic i Geològic de Catalunya (ICGC)';

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Only facts leave tenspla.cat through the widget: title, dates, place, categories, a free flag and
// a syndication-approved image. Descriptions, prices, ticket and affiliate links are never exposed.
function toWidgetPlan(plan, placeNames, today) {
  const date = plan.nextOccurrence?.localDate || plan.start_date || null;
  const image = plan.image && (plan.image.kind === 'official' || plan.image.kind === 'generic')
    ? { url: plan.image.url, alt: plan.image.kind === 'generic' ? plan.image.alt || '' : '' }
    : null;
  return {
    id: plan.id,
    title: plan.title,
    permanent: plan.permanent,
    date,
    ongoing: Boolean(date && date < today),
    endDate: plan.end_date && plan.end_date !== date ? plan.end_date : null,
    municipality: placeNames.officialMunicipalityName(plan.municipality),
    venue: plan.venue_name || null,
    free: plan.free === true,
    categories: (plan.categories || []).map(({ slug, name }) => ({ slug, name })),
    image,
  };
}

export class EmbedWidgetService {
  constructor({ planRepository, placeNames = OfficialPlaceNames.load(), now = () => new Date(), cacheTtlMs = 5 * 60 * 1000 }) {
    this.planRepository = planRepository;
    this.placeNames = placeNames;
    this.now = now;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
  }

  query(config, language, territory, { permanent }) {
    const today = retentionCutoff(0, this.now());
    const filters = {
      syndicatedOnly: true,
      lang: language,
      sort: 'date',
      page: 1,
      limit: config.limit,
      permanent: permanent ? 1 : 0,
      ...territory,
    };
    if (config.categories.length) filters.categories = config.categories;
    if (config.freeOnly) filters.free = 1;
    if (!permanent) {
      filters.dateFrom = today;
      filters.dateTo = addDays(today, config.windowDays - 1);
    }
    return this.planRepository.findMany(filters).plans;
  }

  sectionPlans(config, language, permanent) {
    const { territory } = config;
    if (!territory.municipality) {
      return this.query(config, language, { comarca: territory.comarca }, { permanent });
    }
    const local = this.query(config, language, { municipality: territory.municipality }, { permanent });
    if (!territory.fallbackToComarca || local.length >= Math.min(territory.fallbackMinimum, config.limit)) {
      return local;
    }
    const seen = new Set(local.map(({ id }) => id));
    const wider = this.query(config, language, { comarca: territory.comarca }, { permanent })
      .filter(({ id }) => !seen.has(id));
    return [...local, ...wider].slice(0, config.limit);
  }

  buildView(widget, language) {
    const cacheKey = `${widget.id}:${widget.updatedAt}:${language}:${retentionCutoff(0, this.now())}`;
    const cached = this.cache.get(cacheKey);
    const nowMs = this.now().getTime();
    if (cached && cached.expiresAt > nowMs) return cached.view;

    const { config } = widget;
    const today = retentionCutoff(0, this.now());
    const sections = config.sections.map((id) => ({
      id,
      plans: this.sectionPlans(config, language, id === 'permanent').map((plan) => toWidgetPlan(plan, this.placeNames, today)),
    }));
    const planIds = [...new Set(sections.flatMap(({ plans }) => plans.map(({ id }) => id)))];
    const view = {
      sections,
      attributions: [...this.planRepository.syndicationAttributions(planIds), ICGC_ATTRIBUTION],
      updatedAt: this.planRepository.latestSyndicatedImportAt(),
    };
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(cacheKey, { view, expiresAt: nowMs + this.cacheTtlMs });
    return view;
  }
}
