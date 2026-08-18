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

  it('references versioned local WOFF2 assets with swap rendering', () => {
    const css = fs.readFileSync(path.join(frontendRoot, 'src/styles/index.css'), 'utf8');
    expect(css).toContain('inter-latin-400-700.woff2');
    expect(css).toContain('source-serif-4-latin-600-700.woff2');
    expect(css.match(/font-display: swap/g)).toHaveLength(2);
    for (const filename of ['inter-latin-400-700.woff2', 'source-serif-4-latin-600-700.woff2']) {
      expect(fs.statSync(path.join(frontendRoot, 'src/assets/fonts', filename)).size).toBeGreaterThan(0);
    }
  });
});
