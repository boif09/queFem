import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_FALLBACK_ASSET_ROOT, loadFallbackImageLibrary } from '../backend/src/images/fallbackImageLibrary.js';

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function usage() {
  throw new Error('Ús: node scripts/prepareFallbackImages.js --input <directori-d-originals> | --validate');
}

function parseArguments(argumentsList) {
  if (argumentsList.length === 1 && argumentsList[0] === '--validate') return { validate: true };
  if (argumentsList.length === 2 && argumentsList[0] === '--input') return { input: path.resolve(argumentsList[1]) };
  return usage();
}

function sourceFiles(items, input) {
  if (!fs.statSync(input, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No existeix el directori d’originals: ${input}`);
  const sources = new Map();
  for (const item of items) {
    const matches = SUPPORTED_EXTENSIONS.map((extension) => path.join(input, `${item.id}${extension}`)).filter((candidate) => fs.existsSync(candidate));
    if (matches.length !== 1) throw new Error(`Cal exactament un original per ${item.id} amb el nom ${item.id}.jpg/.jpeg/.png/.webp`);
    sources.set(item.id, matches[0]);
  }
  return sources;
}

function requireCwebp() {
  const result = spawnSync('cwebp', ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Cal instal·lar cwebp per preparar els assets (no es descarrega ni s’executa cap servei extern).');
}

function convert(source, destination, width, quality) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const result = spawnSync('cwebp', ['-quiet', '-q', String(quality), '-resize', String(width), '0', source, '-o', destination], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`No s’ha pogut convertir ${source}: ${result.stderr || result.error?.message || 'error desconegut'}`);
}

function validateAssets(library) {
  const missing = library.items.filter((item) => {
    const state = library.availableAssets.get(item.id);
    return !state.detail || !state.card;
  });
  if (missing.length) throw new Error(`Falten ${missing.length} de 100 imatges (master i/o card). Primera: ${missing[0].id}`);
  return 100;
}

const options = parseArguments(process.argv.slice(2));
if (options.validate) {
  const count = validateAssets(loadFallbackImageLibrary());
  console.log(`Validació correcta: ${count}/100 imatges WebP locals.`);
} else {
  const library = loadFallbackImageLibrary();
  const originals = sourceFiles(library.items, options.input);
  requireCwebp();
  for (const item of library.items) {
    const source = originals.get(item.id);
    convert(source, path.join(DEFAULT_FALLBACK_ASSET_ROOT, item.local_filename), 1600, 82);
    convert(source, path.join(DEFAULT_FALLBACK_ASSET_ROOT, 'card', item.local_filename), 800, 80);
  }
  const count = validateAssets(loadFallbackImageLibrary({ assetRoot: DEFAULT_FALLBACK_ASSET_ROOT, assetExists: (candidate) => fs.existsSync(candidate) }));
  console.log(`Preparació correcta: ${count}/100 imatges WebP locals.`);
}
