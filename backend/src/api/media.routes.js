import { Router } from 'express';
import { TicketmasterMediaError } from '../ticketmaster/imageProxy.js';

export function createMediaRouter({ repository, proxy, enabled }) {
  const router = Router();
  router.get('/ticketmaster/:imageId', async (request, response) => {
    try {
      if (Object.keys(request.query).length > 0) {
        return response.status(400).json({ error: { code: 'UNKNOWN_PARAMETER', message: 'Paràmetre no admès.' } });
      }
      if (!enabled || !/^\d+$/.test(request.params.imageId)) {
        return response.status(404).json({ error: { code: 'MEDIA_NOT_FOUND', message: 'Imatge no trobada.' } });
      }
      const image = repository.findServableTicketmasterImage(Number(request.params.imageId));
      if (!image) return response.status(404).json({ error: { code: 'MEDIA_NOT_FOUND', message: 'Imatge no trobada.' } });
      const media = await proxy.get(image);
      response.set({
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': media.contentType,
        'Content-Length': String(media.data.length),
        'X-Content-Type-Options': 'nosniff',
        'X-Tenspla-Cache': media.cacheStatus,
      });
      return response.status(200).send(media.data);
    } catch (error) {
      if (error instanceof TicketmasterMediaError) {
        return response.status(error.status).json({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
  return router;
}
