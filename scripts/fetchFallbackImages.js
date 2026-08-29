import 'dotenv/config';
import path from 'node:path';
import { loadFallbackImageLibrary } from '../backend/src/images/fallbackImageLibrary.js';
import { DEFAULT_FALLBACK_ORIGINALS_PATH, PexelsFallbackAcquirer } from '../backend/src/images/pexelsFallbackAcquisition.js';

function parseArguments(argumentsList) {
  if (argumentsList.length === 0) return { outputDirectory: DEFAULT_FALLBACK_ORIGINALS_PATH };
  if (argumentsList.length === 2 && argumentsList[0] === '--output') return { outputDirectory: path.resolve(argumentsList[1]) };
  throw new Error('Ús: node scripts/fetchFallbackImages.js [--output <directori-d-originals>]');
}

const options = parseArguments(process.argv.slice(2));
const library = loadFallbackImageLibrary();
const acquirer = new PexelsFallbackAcquirer({ apiKey: process.env.PEXELS_API_KEY, outputDirectory: options.outputDirectory });
const result = await acquirer.acquireAll(library.items);
console.log(`Pexels originals: ${result.downloaded} descarregats, ${result.skipped} ja presents (${result.total} en total).`);
