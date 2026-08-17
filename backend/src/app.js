import express from 'express';
import { createCategoriesRouter } from './api/categories.routes.js';
import { createLocationsRouter } from './api/locations.routes.js';
import { createPlansRouter } from './api/plans.routes.js';
import { createSourcesRouter } from './api/sources.routes.js';
import { ValidationError } from './api/validation.js';
import { PlanQueryRepository } from './db/repositories/planQuery.repository.js';

export function createApp({
  db,
  defaultLanguage = 'ca',
  eventRetentionDays = 90,
  now = () => new Date(),
  logger = console,
}) {
  const app = express();
  const repository = new PlanQueryRepository(db, { eventRetentionDays, now });

  app.disable('x-powered-by');
  app.use('/api/plans', createPlansRouter(repository, defaultLanguage));
  app.use('/api/categories', createCategoriesRouter(repository));
  app.use('/api/sources', createSourcesRouter(repository));
  app.use('/api', createLocationsRouter(repository));

  app.use((request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Endpoint no trobat.' },
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof ValidationError) {
      return response.status(400).json({
        error: { code: error.code, message: error.message },
      });
    }
    logger.error('Error intern de l’API.');
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'S’ha produït un error intern.' },
    });
  });

  return app;
}
