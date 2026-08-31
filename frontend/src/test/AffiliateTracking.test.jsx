import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n.js';
import { PlanDetailPage } from '../pages/PlanDetailPage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: { getPlan: vi.fn() } }));

function mockPlan({ id = 21, sourceRecordId = '706056', commerce = true, websiteUrl = null } = {}) {
  api.getPlan.mockResolvedValue({ data: {
    id, kind: 'event', title: 'Experiencia Fever', start_date: '2026-09-01', end_date: '2026-09-01',
    permanent: false, free: false, venue_name: 'Sala', municipality: 'Barcelona', website_url: websiteUrl,
    categories: [{ slug: 'cultura', name: 'Cultura', icon: 'book-open' }], sources: [],
    ...(commerce ? { commerce: {
      provider: 'fever', affiliateUrl: 'https://fever.pxf.io/AbCdEf?irclickid=kept-exactly',
      sourceRecordId, price: { type: 'fixed', amount: 12 },
    } } : {}),
  } });
}

function renderDetail(id = 21) {
  return render(<MemoryRouter initialEntries={[`/plans/${id}`]}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter>);
}

describe('AffiliateTracking', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    delete window.umami;
    await i18n.changeLanguage('ca');
  });

  it('fires one compact event only when the Fever affiliate CTA is clicked', async () => {
    const track = vi.fn();
    window.umami = { track };
    mockPlan();
    renderDetail();

    const cta = await screen.findByRole('link', { name: /Fever/i });
    expect(track).not.toHaveBeenCalled();
    expect(cta).toHaveAttribute('href', 'https://fever.pxf.io/AbCdEf?irclickid=kept-exactly');
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(cta);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('affiliate_click', {
      source: 'fever', plan_id: 21, source_record_id: '706056', placement: 'detail_cta', language: 'ca',
    });
  });

  it('does not track a non-affiliate external link', async () => {
    const track = vi.fn();
    window.umami = { track };
    mockPlan({ id: 22, commerce: false, websiteUrl: 'https://example.test/official' });
    renderDetail(22);

    fireEvent.click(await screen.findByRole('link', { name: /Web oficial/i }));
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps the CTA usable when analytics is unavailable or throws', async () => {
    mockPlan({ id: 23 });
    renderDetail(23);
    const cta = await screen.findByRole('link', { name: /Fever/i });
    const unavailableClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(() => cta.dispatchEvent(unavailableClick)).not.toThrow();
    expect(unavailableClick.defaultPrevented).toBe(false);
    window.umami = { track: vi.fn(() => { throw new Error('analytics unavailable'); }) };
    const failedClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(() => cta.dispatchEvent(failedClick)).not.toThrow();
    expect(failedClick.defaultPrevented).toBe(false);
    expect(cta).toHaveAttribute('href', 'https://fever.pxf.io/AbCdEf?irclickid=kept-exactly');
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('sends the current Spanish UI language', async () => {
    await i18n.changeLanguage('es');
    const track = vi.fn();
    window.umami = { track };
    mockPlan({ id: 24, sourceRecordId: '706057' });
    renderDetail(24);

    fireEvent.click(await screen.findByRole('link', { name: /Fever/i }));
    expect(track).toHaveBeenCalledWith('affiliate_click', {
      source: 'fever', plan_id: 24, source_record_id: '706057', placement: 'detail_cta', language: 'es',
    });
  });
});
