import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ScrollManager, shouldScrollToTop } from '../components/ScrollManager.jsx';

let navigate;
function NavigateHandle() {
  navigate = useNavigate();
  return null;
}

function renderApp(initial = '/plans') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ScrollManager />
      <NavigateHandle />
      <Routes><Route path="*" element={<div>page</div>} /></Routes>
    </MemoryRouter>,
  );
}

function scrollBy(y) {
  act(() => {
    window.scrollY = y;
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('scroll manager', () => {
  beforeEach(() => {
    window.scrollY = 0;
    window.history.scrollRestoration = 'auto';
    // Runs the frame at once; returning 0 mirrors a browser where the frame has already fired.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(); return 0; });
    window.scrollTo = vi.fn(({ top }) => { window.scrollY = top; });
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts a new page at the top, instantly', () => {
    renderApp('/plans');
    scrollBy(2500);
    act(() => navigate('/plans/42'));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('starts the next results page at the top but keeps the position when only filters change', () => {
    renderApp('/plans?q=jazz');
    scrollBy(1800);
    act(() => navigate('/plans?q=jazz&free=1', { replace: true }));
    expect(window.scrollTo).not.toHaveBeenCalled();
    act(() => navigate('/plans?q=jazz&free=1&page=2'));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('returns to where the previous page was left when going back', () => {
    renderApp('/plans');
    scrollBy(2500);
    act(() => navigate('/plans/42'));
    scrollBy(900);
    act(() => navigate(-1));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 2500, left: 0, behavior: 'instant' });
    act(() => navigate(1));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 900, left: 0, behavior: 'instant' });
  });

  it('leaves links to an anchor alone and turns off the browser restoration it replaces', () => {
    const { unmount } = renderApp('/legal');
    expect(window.history.scrollRestoration).toBe('manual');
    scrollBy(400);
    act(() => navigate('/fonts#icgc'));
    expect(window.scrollTo).not.toHaveBeenCalled();
    unmount();
  });

  it('decides by path and results page only', () => {
    expect(shouldScrollToTop(null, { pathname: '/', search: '' })).toBe(false);
    expect(shouldScrollToTop({ pathname: '/', search: '' }, { pathname: '/plans', search: '' })).toBe(true);
    expect(shouldScrollToTop({ pathname: '/plans', search: '?page=2' }, { pathname: '/plans', search: '' })).toBe(true);
    expect(shouldScrollToTop({ pathname: '/plans', search: '?q=a' }, { pathname: '/plans', search: '?q=b' })).toBe(false);
  });
});
