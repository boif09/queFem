import { Router } from 'express';
import {
  validateComarquesQuery, validateMunicipalitiesQuery, validateNoQueryParameters,
} from './validation.js';

export function createLocationsRouter(repository) {
  const router = Router();

  router.get('/provinces', (request, response) => {
    validateNoQueryParameters(request.query);
    response.json({ data: repository.findProvinces() });
  });

  router.get('/comarques', (request, response) => {
    const { province } = validateComarquesQuery(request.query);
    response.json({ data: repository.findComarques(province) });
  });

  router.get('/municipalities', (request, response) => {
    const filters = validateMunicipalitiesQuery(request.query);
    response.json({ data: repository.findMunicipalities(filters) });
  });

  return router;
}
