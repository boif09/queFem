import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n.js';
import { AppRoutes } from '../App.jsx';

vi.mock('../services/api.js', () => ({
  api: {
    getSources: vi.fn(), getPlans: vi.fn(), getPlan: vi.fn(),
    getProvinces: vi.fn(), getComarques: vi.fn(), getMunicipalities: vi.fn(), getCategories: vi.fn(),
  },
}));

function renderWidgetPage() {
  return render(<MemoryRouter initialEntries={['/widget']}><AppRoutes /></MemoryRouter>);
}

describe('widget page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ca');
  });

  it('explains the widget, embeds the live demo and offers the contact email', async () => {
    renderWidgetPage();
    expect(screen.getByRole('heading', { level: 1, name: 'L’agenda de Tens pla? a la teva web' })).toBeInTheDocument();
    const frame = screen.getByTitle('Consell comarcal · Bages');
    expect(frame).toHaveAttribute('src', '/embed/v1/w/wgt_TensPlaDemoBages2026?lang=ca');

    const mailLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('mailto:'));
    expect(mailLinks.length).toBeGreaterThan(0);
    for (const link of mailLinks) {
      expect(link.getAttribute('href')).toBe(`mailto:contacte@tenspla.cat?subject=${encodeURIComponent('Agenda de Tens pla? per a la meva web')}`);
    }
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/widget');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
    expect(screen.getByRole('link', { name: 'Agenda per a la teva web' })).toHaveAttribute('href', '/widget');
    expect(document.body.textContent).not.toMatch(/preu|pagament|gratu[iï]t|€/i);

    await userEvent.click(screen.getByRole('button', { name: 'Allotjament · Pals' }));
    expect(screen.getByTitle('Allotjament · Pals')).toHaveAttribute('src', '/embed/v1/w/wgt_TensPlaDemoEmporda2026?lang=ca');
  });

  it('follows the Spanish interface language', async () => {
    await i18n.changeLanguage('es');
    renderWidgetPage();
    expect(screen.getByRole('heading', { level: 1, name: 'La agenda de Tens pla? en tu web' })).toBeInTheDocument();
    expect(screen.getByTitle('Consell comarcal · Bages')).toHaveAttribute('src', '/embed/v1/w/wgt_TensPlaDemoBages2026?lang=es');
  });

  it('resizes the demo only for messages from its own frame', () => {
    renderWidgetPage();
    const frame = screen.getByTitle('Consell comarcal · Bages');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', source: frame.contentWindow, data: { type: 'tenspla:resize', height: 900 } }));
    });
    expect(frame.style.height).toBe('640px');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: 'tenspla:resize', height: 912.4 } }));
    });
    expect(frame.style.height).toBe('913px');
  });
});
