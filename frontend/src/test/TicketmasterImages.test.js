import { describe, expect, it } from 'vitest';
import css from '../styles/pop-editorial.css?raw';

describe('Ticketmaster image layout', () => {
  it('reserves a 16:9 aspect ratio for card and detail images', () => {
    expect(css).toMatch(/\.plan-visual\.has-image\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    expect(css).toMatch(/\.detail-visual\.has-image\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  });
});
