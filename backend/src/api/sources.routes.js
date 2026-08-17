import { Router } from 'express';
import { validateNoQueryParameters } from './validation.js';

export function createSourcesRouter(repository) {
  const router = Router();

  router.get('/', (request, response) => {
    validateNoQueryParameters(request.query);
    response.json({ data: repository.findSources() });
  });

  return router;
}
