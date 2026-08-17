import { Router } from 'express';
import { validateNoQueryParameters } from './validation.js';

export function createCategoriesRouter(repository) {
  const router = Router();

  router.get('/', (request, response) => {
    validateNoQueryParameters(request.query);
    response.json({ data: repository.findCategories() });
  });

  return router;
}
