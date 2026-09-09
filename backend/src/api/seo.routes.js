import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { buildEventJsonLd, compactDescription, PUBLIC_ORIGIN } from '../../../shared/seo/eventJsonLd.js';
import { renderSeoHtml } from '../seo/seoHtml.js';
import { validatePlanId } from './validation.js';

const HOME = { title: 'Tens pla? | Plans i activitats a Catalunya', description: 'Descobreix concerts, festes, cultura, mercats i activitats arreu de Catalunya. Troba què fer avui o aquest cap de setmana amb Tens pla?.' };
const PLANS = { title: 'Explora plans a Catalunya | Tens pla?', description: 'Explora concerts, festes, cultura, mercats i activitats disponibles arreu de Catalunya amb Tens pla?.' };
const TODAY = { title: 'Què fer avui a Catalunya | Tens pla?', description: 'Descobreix activitats, festes, cultura, concerts i plans per fer avui arreu de Catalunya amb Tens pla?.' };
const WEEKEND = { title: 'Què fer aquest cap de setmana a Catalunya | Tens pla?', description: 'Descobreix activitats i plans per fer aquest cap de setmana arreu de Catalunya amb Tens pla?.' };

function sendHtml(response, status, html) { return response.status(status).type('html').send(html); }
function notFoundHtml(template) { return renderSeoHtml(template, { title: 'Pàgina no trobada | Tens pla?', description: 'La pàgina sol·licitada no existeix o ja no està disponible.', robots: 'noindex,follow' }); }
function planMetadata(plan) {
  const locationLabel = plan.municipality ? ` a ${plan.municipality}` : '';
  const title = `${plan.title}${locationLabel} | Tens pla?`;
  const description = compactDescription(plan.description) || `Consulta data, ubicació i informació de ${plan.title}${locationLabel}.`;
  const canonicalPath = `/plans/${encodeURIComponent(plan.id)}`;
  return { title, description, canonicalPath, jsonLd: buildEventJsonLd(plan, `${PUBLIC_ORIGIN}${canonicalPath}`, description) };
}

export function createSeoRouter(repository, { templatePath = path.resolve(process.cwd(), 'frontend/dist/index.html'), template = null } = {}) {
  const router = Router();
  const readTemplate = () => template ?? fs.readFileSync(templatePath, 'utf8');
  const withTemplate = (handler) => (request, response, next) => {
    try { return handler(request, response, readTemplate()); } catch (error) { return next(error); }
  };
  router.get('/', withTemplate((request, response, html) => {
    const filtered = Object.keys(request.query).length > 0;
    return sendHtml(response, 200, renderSeoHtml(html, { ...HOME, robots: filtered ? 'noindex,follow' : 'index,follow', canonicalPath: filtered ? null : '/' }));
  }));
  router.get('/plans', withTemplate((request, response, html) => {
    const filtered = Object.keys(request.query).length > 0;
    return sendHtml(response, 200, renderSeoHtml(html, { ...PLANS, robots: filtered ? 'noindex,follow' : 'index,follow', canonicalPath: filtered ? null : '/plans' }));
  }));
  router.get('/avui', withTemplate((request, response, html) => {
    const filtered = Object.keys(request.query).length > 0;
    return sendHtml(response, 200, renderSeoHtml(html, { ...TODAY, robots: filtered ? 'noindex,follow' : 'index,follow', canonicalPath: filtered ? null : '/avui' }));
  }));
  router.get('/cap-de-setmana', withTemplate((request, response, html) => {
    const filtered = Object.keys(request.query).length > 0;
    return sendHtml(response, 200, renderSeoHtml(html, { ...WEEKEND, robots: filtered ? 'noindex,follow' : 'index,follow', canonicalPath: filtered ? null : '/cap-de-setmana' }));
  }));
  router.get('/plans/:id', withTemplate((request, response, html) => {
    let id;
    try { id = validatePlanId(request.params.id); } catch { return sendHtml(response, 404, notFoundHtml(html)); }
    const plan = repository.findById(id, 'ca');
    if (!plan) return sendHtml(response, 404, notFoundHtml(html));
    const event = plan.kind === 'event';
    const metadata = planMetadata(plan);
    return sendHtml(response, 200, renderSeoHtml(html, {
      ...metadata,
      robots: event ? 'index,follow' : 'noindex,follow',
      canonicalPath: event ? metadata.canonicalPath : null,
      jsonLd: event ? metadata.jsonLd : null,
    }));
  }));
  return router;
}
