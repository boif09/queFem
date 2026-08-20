import express from 'express';
import { createCategoriesRouter } from './api/categories.routes.js';
import { createLocationsRouter } from './api/locations.routes.js';
import { createMediaRouter } from './api/media.routes.js';
import { createPlansRouter } from './api/plans.routes.js';
import { createSourcesRouter } from './api/sources.routes.js';
import { createSitemapRouter } from './api/sitemap.routes.js';
import { ValidationError } from './api/validation.js';
import { PlanQueryRepository } from './db/repositories/planQuery.repository.js';
import { PlanSourceImageRepository } from './db/repositories/planSourceImage.repository.js';
import { TicketmasterImageCache } from './ticketmaster/imageCache.js';
import { TicketmasterImageProxy } from './ticketmaster/imageProxy.js';

export function createApp({
  db,
  defaultLanguage = 'ca',
  eventRetentionDays = 0,
  ticketmasterImagesEnabled = false,
  ticketmasterImageCachePath,
  ticketmasterImageCacheTtlHours = 6,
  ticketmasterImageCacheMaxMb = 512,
  ticketmasterImageRequestTimeoutMs = 15_000,
  ticketmasterImageMaximumBytes = 10 * 1024 * 1024,
  ticketmasterImageFetchImpl,
  now = () => new Date(),
  logger = console,
}) {
  const app = express();
  const repository = new PlanQueryRepository(db, {
    eventRetentionDays, now, ticketmasterImagesEnabled,
  });
  const imageRepository = new PlanSourceImageRepository(db);
  const imageCache = new TicketmasterImageCache({
    directory: ticketmasterImageCachePath || `${process.cwd()}/data/cache/ticketmaster-images`,
    ttlHours: ticketmasterImageCacheTtlHours,
    maximumMb: ticketmasterImageCacheMaxMb,
    now,
  });
  const imageProxy = new TicketmasterImageProxy({
    cache: imageCache,
    fetchImpl: ticketmasterImageFetchImpl,
    timeoutMs: ticketmasterImageRequestTimeoutMs,
    maximumBytes: ticketmasterImageMaximumBytes,
    validImageIds: () => imageRepository.findAllImageIds(),
  });

  app.disable('x-powered-by');
  app.use('/api/sitemap.xml', createSitemapRouter(repository));
  app.use('/api/media', createMediaRouter({
    repository: imageRepository, proxy: imageProxy, enabled: ticketmasterImagesEnabled,
  }));
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
