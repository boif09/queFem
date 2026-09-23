import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureSocialAttributionFromLocation,
  getSocialAttribution,
  resetSocialAttributionForTests,
  withSocialAttribution,
} from '../services/socialAttribution.js';

const key = 'tenspla.socialAttribution.v1';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  resetSocialAttributionForTests();
});

describe('social attribution', () => {
  it.each(['instagram', 'tiktok'])('captures a valid %s social landing', (source) => {
    captureSocialAttributionFromLocation(`?utm_source=${source}&utm_medium=social`);
    expect(getSocialAttribution()).toEqual({ social_source: source, social_medium: 'social' });
  });

  it('normalizes whitespace and case, retaining valid campaign and content only', () => {
    captureSocialAttributionFromLocation('?utm_source=%20Instagram%20&utm_medium=%20SOCIAL%20&utm_campaign=%202026w39-capsetmana%20&utm_content=%2020260925-capsetmana5.story%20');
    expect(getSocialAttribution()).toEqual({
      social_source: 'instagram', social_medium: 'social',
      social_campaign: '2026w39-capsetmana', social_content: '20260925-capsetmana5.story',
    });
  });

  it.each([
    '?utm_source=facebook&utm_medium=social',
    '?utm_source=random&utm_medium=social',
    '?utm_source=instagram&utm_medium=email',
    '?utm_source=instagram',
  ])('ignores unsupported or incomplete UTMs: %s', (search) => {
    captureSocialAttributionFromLocation(search);
    expect(getSocialAttribution()).toBeNull();
  });

  it('keeps first touch through later social and untagged locations', () => {
    captureSocialAttributionFromLocation('?utm_source=instagram&utm_medium=social&utm_campaign=first');
    captureSocialAttributionFromLocation('?utm_source=tiktok&utm_medium=social&utm_campaign=second');
    captureSocialAttributionFromLocation('?anything=else');
    expect(getSocialAttribution()).toEqual({ social_source: 'instagram', social_medium: 'social', social_campaign: 'first' });
  });

  it('drops malformed and overlong optional fields without dropping the source', () => {
    captureSocialAttributionFromLocation(`?utm_source=tiktok&utm_medium=social&utm_campaign=bad%20value&utm_content=${'a'.repeat(81)}`);
    expect(getSocialAttribution()).toEqual({ social_source: 'tiktok', social_medium: 'social' });
  });

  it('stores no extra query parameters', () => {
    captureSocialAttributionFromLocation('?utm_source=instagram&utm_medium=social&fbclid=secret&email=person%40example.test');
    expect(JSON.parse(window.sessionStorage.getItem(key))).toEqual({ social_source: 'instagram', social_medium: 'social' });
    expect(withSocialAttribution({ event: 'test' })).toEqual({ event: 'test', social_source: 'instagram', social_medium: 'social' });
  });

  it('treats tampered storage as invalid', () => {
    window.sessionStorage.setItem(key, '{bad json');
    expect(getSocialAttribution()).toBeNull();
    window.sessionStorage.setItem(key, JSON.stringify({ social_source: 'facebook', social_medium: 'social' }));
    expect(getSocialAttribution()).toBeNull();
  });

  it('uses in-memory attribution when sessionStorage read or write throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => captureSocialAttributionFromLocation('?utm_source=instagram&utm_medium=social')).not.toThrow();
    expect(getSocialAttribution()).toEqual({ social_source: 'instagram', social_medium: 'social' });
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('uses in-memory attribution when only sessionStorage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    captureSocialAttributionFromLocation('?utm_source=tiktok&utm_medium=social');
    expect(getSocialAttribution()).toEqual({ social_source: 'tiktok', social_medium: 'social' });
    expect(withSocialAttribution({ event: 'test' })).toEqual({
      event: 'test', social_source: 'tiktok', social_medium: 'social',
    });
  });
});
