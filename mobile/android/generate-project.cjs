// Regenerates the Android (TWA) project from twa-manifest.json with @bubblewrap/core 1.25.0.
// Usage: npm install --prefix <tmp> @bubblewrap/core@1.25.0
//        BUBBLEWRAP_CORE=<tmp>/node_modules/@bubblewrap/core node mobile/android/generate-project.cjs
const path = require('node:path');
const fs = require('node:fs');

const corePath = process.env.BUBBLEWRAP_CORE;
if (!corePath) {
  console.error('Set BUBBLEWRAP_CORE to the @bubblewrap/core 1.25.0 folder.');
  process.exit(1);
}
const { TwaGenerator, TwaManifest, ConsoleLog } = require(corePath);

(async () => {
  const projectDir = __dirname;
  const json = JSON.parse(fs.readFileSync(path.join(projectDir, 'twa-manifest.json'), 'utf8'));
  const manifest = new TwaManifest(json);
  const error = manifest.validate();
  if (error) throw new Error(error);
  await new TwaGenerator().createTwaProject(projectDir, manifest, new ConsoleLog('generate'));
  console.log('Android project generated in', projectDir);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
