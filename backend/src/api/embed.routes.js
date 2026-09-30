import fs from 'node:fs';
import { Router } from 'express';
import { isValidWidgetKey, WIDGET_LANGUAGES, WIDGET_THEMES } from '../embed/widgetConfig.js';
import { renderUnavailable, renderWidget } from '../embed/renderWidget.js';

const LOADER_SOURCE = fs.readFileSync(new URL('../embed/public/loader.js', import.meta.url), 'utf8');
const WIDGET_PARAMETERS = new Set(['lang', 'theme']);

function contentSecurityPolicy({ styleHash, scriptHash }, frameAncestors) {
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    "font-src 'self'",
    `style-src ${styleHash}`,
    `script-src ${scriptHash}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(' ') : "'none'"}`,
  ].join('; ');
}

// Unavailable pages carry no plan data, so any site may frame them; the loader then shrinks the
// iframe to the short notice instead of leaving a blank, blocked box.
const ANY_ANCESTOR = ['*'];

function sendPage(response, status, rendered, frameAncestors, cacheControl) {
  response.status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Content-Security-Policy', contentSecurityPolicy(rendered, frameAncestors))
    .set('Cache-Control', cacheControl)
    .set('Referrer-Policy', 'strict-origin-when-cross-origin')
    .set('X-Content-Type-Options', 'nosniff')
    .send(rendered.html);
}

function refererOrigin(request) {
  const referer = request.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin.toLowerCase();
  } catch {
    return null;
  }
}

function singleOption(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

export function createEmbedRouter({ widgetRepository, widgetService, usageRecorder, logger = console }) {
  const router = Router();

  router.get('/v1/loader.js', (request, response) => {
    response.set('Content-Type', 'text/javascript; charset=utf-8')
      .set('Cache-Control', 'public, max-age=3600')
      .set('Cross-Origin-Resource-Policy', 'cross-origin')
      .set('X-Content-Type-Options', 'nosniff')
      .send(LOADER_SOURCE);
  });

  router.get('/v1/w/:key', (request, response) => {
    const unknownParameters = Object.keys(request.query).some((name) => !WIDGET_PARAMETERS.has(name));
    const requestedLanguage = singleOption(request.query.lang, WIDGET_LANGUAGES);
    const language = requestedLanguage || 'ca';
    const widget = isValidWidgetKey(request.params.key) ? widgetRepository.findByKey(request.params.key) : null;

    if (!widget || widget.status === 'revoked') {
      return sendPage(response, 404, renderUnavailable({ language }), ANY_ANCESTOR, 'no-store');
    }
    const origins = widget.allowedOrigins;
    if (widget.status !== 'active' || unknownParameters) {
      return sendPage(response, widget.status === 'active' ? 400 : 403, renderUnavailable({ language }), ANY_ANCESTOR, 'no-store');
    }

    // The browser enforces frame-ancestors; this server-side check only adds evidence of reuse on
    // other sites. A missing Referer (strict host policies) is allowed and counted as unknown.
    const origin = refererOrigin(request);
    const framed = request.get('sec-fetch-dest') === 'iframe';
    if (framed && origin && !origins.includes(origin)) {
      usageRecorder.record(widget.id, origin, { rejected: true });
      return sendPage(response, 403, renderUnavailable({ language }), ANY_ANCESTOR, 'no-store');
    }

    let view;
    try {
      view = widgetService.buildView(widget, requestedLanguage || widget.config.language);
    } catch (error) {
      logger.error(`Error en generar el widget ${widget.id}: ${error.message}`);
      return sendPage(response, 500, renderUnavailable({ language }), ANY_ANCESTOR, 'no-store');
    }
    if (framed) usageRecorder.record(widget.id, origin || 'unknown');
    const rendered = renderWidget({
      widget,
      view,
      language: requestedLanguage || widget.config.language,
      theme: singleOption(request.query.theme, WIDGET_THEMES) || widget.config.theme,
    });
    // Revalidate on every load so suspension, revocation, rotation and origin changes apply at once;
    // the in-process view cache keeps rebuilds cheap.
    return sendPage(response, 200, rendered, origins, 'no-cache');
  });

  return router;
}
