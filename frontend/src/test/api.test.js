import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('category API cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('shares an in-flight category request and reuses its successful result', async () => {
    const json = vi.fn().mockResolvedValue({ data: [{ slug: 'musica' }] });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json });
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('../services/api.js');

    const [first, second] = await Promise.all([api.getCategories(), api.getCategories()]);
    const third = await api.getCategories();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(third).toBe(first);
  });

  it('evicts a failed category request so a later attempt can succeed', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ data: [] }) });
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('../services/api.js');

    await expect(api.getCategories()).rejects.toThrow('offline');
    await expect(api.getCategories()).resolves.toEqual({ data: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
