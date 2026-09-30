import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { EmbedWidgetRepository } from '../db/repositories/embedWidget.repository.js';
import {
  generateWidgetKey, normalizeOrigins, normalizeWidgetConfig, WidgetConfigError,
} from '../embed/widgetConfig.js';
import { OfficialPlaceNames } from '../embed/placeNames.js';
import { retentionCutoff } from '../retention/eventRetention.js';

const USAGE = `Ús: npm run embed:widgets -- <ordre> [opcions]
  list
  show <clau>
  create --name <nom> --origins <https://a.cat,https://www.a.cat> --config <fitxer.json> [--client <client>] [--notes <text>]
  update <clau> [--name ..] [--client ..] [--origins ..] [--config fitxer.json] [--notes ..]
  suspend <clau> | activate <clau> | revoke <clau>
  rotate <clau>
  usage <clau> [--days 30]
  snippet <clau> [--base https://tenspla.cat]`;

const VALUE_OPTIONS = new Set(['name', 'client', 'origins', 'config', 'notes', 'days', 'base']);

export function parseArguments(args) {
  const [command, ...rest] = args;
  const positional = [];
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!VALUE_OPTIONS.has(name) || rest[index + 1] === undefined) throw new Error(USAGE);
    options[name] = rest[index + 1];
    index += 1;
  }
  if (!command) throw new Error(USAGE);
  return { command, key: positional[0], options };
}

function readConfigFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new WidgetConfigError(`No s’ha pogut llegir la configuració ${file}: ${error.message}`);
  }
}

export function snippet(publicKey, base = 'https://tenspla.cat') {
  return `<div data-tenspla-widget="${publicKey}"></div>\n<script src="${base}/embed/v1/loader.js" async></script>`;
}

function describe(widget) {
  return [
    `${widget.publicKey}  [${widget.status}]  ${widget.name}${widget.clientName ? ` — ${widget.clientName}` : ''}`,
    `  orígens: ${widget.allowedOrigins.join(', ')}`,
    `  configuració: ${JSON.stringify(widget.config)}`,
    ...(widget.notes ? [`  notes: ${widget.notes}`] : []),
    `  creat: ${widget.createdAt}  actualitzat: ${widget.updatedAt}`,
  ].join('\n');
}

export function runEmbedWidgetCommand(db, { command, key, options }, {
  placeNames = OfficialPlaceNames.load(), now = () => new Date(), randomKey = generateWidgetKey,
} = {}) {
  const repository = new EmbedWidgetRepository(db, { now });
  const validateConfig = (file) => normalizeWidgetConfig(readConfigFile(file), {
    placeNames, categorySlugs: repository.categorySlugs(),
  });
  const requireWidget = () => {
    const widget = key && repository.findByKey(key);
    if (!widget) throw new Error(`Widget no trobat: ${key ?? '(sense clau)'}`);
    return widget;
  };

  switch (command) {
    case 'list': {
      const widgets = repository.findAll();
      return widgets.length ? widgets.map(describe).join('\n\n') : 'No hi ha widgets.';
    }
    case 'show':
      return describe(requireWidget());
    case 'create': {
      if (!options.name || !options.origins || !options.config) throw new Error(USAGE);
      const widget = repository.create({
        publicKey: randomKey(),
        name: options.name.trim(),
        clientName: options.client?.trim() || null,
        allowedOrigins: normalizeOrigins(options.origins.split(',')),
        config: validateConfig(options.config),
        notes: options.notes?.trim() || null,
      });
      return `${describe(widget)}\n\nCodi per incrustar:\n${snippet(widget.publicKey)}`;
    }
    case 'update': {
      requireWidget();
      const changes = {};
      if (options.name) changes.name = options.name.trim();
      if (options.client) changes.clientName = options.client.trim();
      if (options.notes) changes.notes = options.notes.trim();
      if (options.origins) changes.allowedOrigins = normalizeOrigins(options.origins.split(','));
      if (options.config) changes.config = validateConfig(options.config);
      if (!Object.keys(changes).length) throw new Error(USAGE);
      return describe(repository.update(key, changes));
    }
    case 'suspend':
    case 'activate':
    case 'revoke': {
      const widget = requireWidget();
      if (widget.status === 'revoked') throw new Error('Un widget revocat no es pot modificar; creeu-ne un de nou.');
      const status = { suspend: 'suspended', activate: 'active', revoke: 'revoked' }[command];
      return describe(repository.update(key, { status }));
    }
    case 'rotate': {
      const widget = requireWidget();
      if (widget.status === 'revoked') throw new Error('Un widget revocat no es pot rotar.');
      const updated = repository.update(key, { publicKey: randomKey() });
      return `${describe(updated)}\n\nLa clau anterior deixa de funcionar ara mateix. Codi nou:\n${snippet(updated.publicKey)}`;
    }
    case 'usage': {
      const widget = requireWidget();
      const days = Number(options.days ?? 30);
      if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('--days ha de ser entre 1 i 366.');
      const since = new Date(`${retentionCutoff(0, now())}T00:00:00Z`);
      since.setUTCDate(since.getUTCDate() - days + 1);
      const rows = repository.usageSince(widget.id, since.toISOString().slice(0, 10));
      if (!rows.length) return `${widget.publicKey}: sense ús registrat els últims ${days} dies.`;
      const totals = new Map();
      for (const row of rows) {
        const total = totals.get(row.origin) || { impressions: 0, rejected: 0 };
        total.impressions += row.impressions;
        total.rejected += row.rejected;
        totals.set(row.origin, total);
      }
      const lines = [...totals].sort((a, b) => b[1].impressions - a[1].impressions)
        .map(([origin, total]) => `  ${origin}: ${total.impressions} càrregues${total.rejected ? `, ${total.rejected} REBUTJADES` : ''}`);
      return `${widget.publicKey}: ús dels últims ${days} dies per origen\n${lines.join('\n')}`;
    }
    case 'snippet':
      return snippet(requireWidget().publicKey, options.base);
    default:
      throw new Error(USAGE);
  }
}

function main() {
  let db;
  try {
    const parsed = parseArguments(process.argv.slice(2));
    const readOnly = ['list', 'show', 'usage', 'snippet'].includes(parsed.command);
    db = openDatabase(loadConfig().databasePath, readOnly ? { readonly: true } : {});
    if (!readOnly) migrate(db);
    console.log(runEmbedWidgetCommand(db, parsed));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
