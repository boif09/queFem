import { Router } from 'express';
import { validateMunicipalitiesQuery, validateNoQueryParameters } from './validation.js';

export function createLocationsRouter(repository) {
  const router = Router();

  router.get('/comarques', (request, response) => {
    validateNoQueryParameters(request.query);
    response.json({ data: repository.findComarques() });
  });

  router.get('/municipalities', (request, response) => {
    const { comarca } = validateMunicipalitiesQuery(request.query);
    response.json({ data: repository.findMunicipalities(comarca) });
  });

  return router;
}
