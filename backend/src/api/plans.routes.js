import { Router } from 'express';
import {
  rejectUnknownParameters,
  validateLanguage,
  validatePlanId,
  validatePlansQuery,
} from './validation.js';

export function createPlansRouter(repository, defaultLanguage) {
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

  router.get('/:id', (request, response) => {
    rejectUnknownParameters(request.query, new Set(['lang']));
    const id = validatePlanId(request.params.id);
    const language = validateLanguage(request.query.lang, defaultLanguage);
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
