import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = path.resolve(import.meta.dirname, '../..');

describe('local fonts', () => {
  it('contains no runtime Google Fonts references', () => {
    const html = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(frontendRoot, 'src/styles/index.css'), 'utf8');
    expect(`${html}\n${css}`).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('bundles the licensed Montserrat variable font locally', () => {
    const main = fs.readFileSync(path.join(frontendRoot, 'src/main.jsx'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(frontendRoot, '../package.json'), 'utf8'));
    const fontPackage = path.resolve(frontendRoot, '../node_modules/@fontsource-variable/montserrat');
    expect(main).toContain("@fontsource-variable/montserrat/wght.css");
    expect(packageJson.dependencies['@fontsource-variable/montserrat']).toBeTruthy();
    expect(fs.statSync(path.join(fontPackage, 'LICENSE')).size).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(frontendRoot, 'src/assets/fonts/MONTSERRAT-OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    expect(fs.readdirSync(path.join(fontPackage, 'files')).some((file) => file.endsWith('.woff2'))).toBe(true);
  });
});
