import { Router } from 'express';
import {
  rejectUnknownParameters,
  validateLanguage,
  validatePlanId,
  validatePlansQuery,
} from './validation.js';

export function createPlansRouter(repository, defaultLanguage, { aliasRepository = null } = {}) {
  const router = Router();

  router.get('/', (request, response) => {
    const filters = validatePlansQuery(request.query, defaultLanguage);
    const { plans, total } = repository.findMany(filters);
    response.json({
      data: plans,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: total === 0 ? 0 : Math.ceil(total / filters.limit),
      },
    });
  });

  // Alias ids are resolved transparently (not via HTTP redirect): this is a
  // JSON API consumed by our own frontend, not by third-party integrators,
  // and a 301 on a fetch() would hide the id change from client-side
  // routing without any code to react to it. The public HTML route
  // (seo.routes.js) is the one that MUST issue a real 301, since that is
  // what search engine crawlers require.
  router.get('/:id', (request, response) => {
    rejectUnknownParameters(request.query, new Set(['lang']));
    const requestedId = validatePlanId(request.params.id);
    const language = validateLanguage(request.query.lang, defaultLanguage);
    const canonicalId = aliasRepository?.findCanonicalId(requestedId);
    const id = canonicalId !== null && canonicalId !== undefined ? canonicalId : requestedId;
    const plan = repository.findById(id, language);
    if (!plan) {
      return response.status(404).json({
        error: { code: 'PLAN_NOT_FOUND', message: 'No s’ha trobat el pla sol·licitat.' },
      });
    }
    return response.json({ data: plan });
  });

  return router;
}
