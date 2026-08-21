import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n.js';
import { AppRoutes } from '../App.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    getSources: vi.fn(), getPlans: vi.fn(), getPlan: vi.fn(),
    getProvinces: vi.fn(), getComarques: vi.fn(), getMunicipalities: vi.fn(), getCategories: vi.fn(),
  },
}));

function renderRoute(route) {
  return render(<MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter>);
}

describe('legal and privacy pages', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
  });

  it.each([
    ['/legal', 'Avís legal'],
    ['/privacitat', 'Política de privacitat'],
    ['/emmagatzematge', 'Emmagatzematge local'],
    ['/contacte', 'Contacte'],
  ])('renders the Catalan route %s', (route, heading) => {
    renderRoute(route);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByText('Darrera actualització: 21/08/2026')).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeInTheDocument();
  });

  it.each([
    ['/privacidad', 'Política de privacidad'],
    ['/almacenamiento', 'Almacenamiento local'],
    ['/contacto', 'Contacto'],
  ])('renders the Spanish alias %s with complete Spanish content', async (route, heading) => {
    await i18n.changeLanguage('es');
    renderRoute(route);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByText('Última actualización: 21/08/2026')).toBeInTheDocument();
  });

  it('states the controller, hosting, minimized logs and retention accurately', async () => {
    await i18n.changeLanguage('es');
    renderRoute('/privacidad');
    expect(screen.getByText(/Xavier Delgado Garcia es el responsable/)).toBeInTheDocument();
    expect(screen.getByText(/La web es https:\/\/tenspla.cat/)).toBeInTheDocument();
    expect(screen.getByText(/Falkenstein, Alemania, zona eu-central/)).toBeInTheDocument();
    expect(screen.getByText(/aproximadamente 14 días/)).toBeInTheDocument();
    expect(screen.getByText(/No registra query strings ni Referer/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Carácter de los datos' })).toBeInTheDocument();
    expect(screen.getByText(/No es necesario facilitar datos personales para navegar/)).toBeInTheDocument();
    expect(screen.getByText(/no vende ni cede datos personales a terceros/)).toBeInTheDocument();
    const privacyEmailLinks = screen.getAllByRole('link', { name: /Escribir a contacte@tenspla.cat/ });
    expect(privacyEmailLinks).toHaveLength(2);
    expect(privacyEmailLinks[0]).toHaveAttribute('href', 'mailto:contacte@tenspla.cat');
  });

  it('describes language and explicit location storage without claiming tracking cookies', async () => {
    await i18n.changeLanguage('es');
    renderRoute('/almacenamiento');
    expect(screen.getByText(/localStorage con la clave quefem.language/)).toBeInTheDocument();
    expect(screen.getByText(/clave quefem.location solo la provincia, la comarca y\/o el municipio/)).toBeInTheDocument();
    expect(screen.getByText(/no se utilizan para publicidad, analítica, seguimiento o perfilado/)).toBeInTheDocument();
    expect(screen.getByText(/no utiliza GPS, identificadores ni cuenta/)).toBeInTheDocument();
    expect(screen.getByText(/no utiliza actualmente cookies propias/)).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap no se carga al abrir una ficha/)).toBeInTheDocument();
  });

  it('documents voluntary external services and Ticketmaster removal contact', async () => {
    await i18n.changeLanguage('es');
    renderRoute('/privacidad');
    expect(screen.getByText(/OpenStreetMap solo se contacta después de pulsar/)).toBeInTheDocument();
    expect(screen.getByText(/Ticketmaster se consulta desde el backend/)).toBeInTheDocument();
    expect(screen.getByText(/Google Maps no está incrustado/)).toBeInTheDocument();
  });

  it('shows the global footer and navigates through localized footer links', async () => {
    const user = userEvent.setup();
    renderRoute('/legal');
    const nav = screen.getByRole('navigation', { name: 'Navegació legal' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Emmagatzematge' })).toHaveAttribute('href', '/emmagatzematge');
    await user.click(screen.getByRole('link', { name: 'Privacitat' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Política de privacitat' })).toBeInTheDocument();
  });

  it('uses the horizontal Stitch logo in the header and footer', () => {
    const { container } = renderRoute('/legal');
    const headerBrand = container.querySelector('.site-header .header-brand-logo');
    const footerBrand = container.querySelector('.site-footer .footer-logo');

    expect(headerBrand).toBeInTheDocument();
    expect(footerBrand).toBeInTheDocument();
    expect(headerBrand).toHaveTextContent('Tens pla?');
    expect(headerBrand.querySelector('[fill="#1A1A1A"]')).toHaveTextContent('Tens pla');
    expect(headerBrand.querySelector('[fill="#FF4D3D"]')).toHaveTextContent('?');
    expect(footerBrand.innerHTML).toBe(headerBrand.innerHTML);
  });

  it('shows mobile navigation only on home and results routes', () => {
    const pending = new Promise(() => {});
    api.getPlans.mockReturnValue(pending);
    api.getCategories.mockReturnValue(pending);
    api.getPlan.mockReturnValue(pending);

    const home = renderRoute('/');
    expect(home.container.querySelector('.mobile-nav')).toBeInTheDocument();
    expect(home.container.querySelector('.site-shell')).toHaveClass('has-mobile-nav');
    home.unmount();

    const results = renderRoute('/plans');
    expect(results.container.querySelector('.mobile-nav')).toBeInTheDocument();
    expect(results.container.querySelector('.site-shell')).toHaveClass('has-mobile-nav');
    results.unmount();

    const detail = renderRoute('/plans/123');
    expect(detail.container.querySelector('.mobile-nav')).not.toBeInTheDocument();
    expect(detail.container.querySelector('.site-shell')).not.toHaveClass('has-mobile-nav');
    detail.unmount();

    const legal = renderRoute('/legal');
    expect(legal.container.querySelector('.mobile-nav')).not.toBeInTheDocument();
    expect(legal.container.querySelector('.site-shell')).not.toHaveClass('has-mobile-nav');
  });

  it('keeps /fonts operational and explains Ticketmaster from confirmed data', async () => {
    api.getSources.mockResolvedValue({ data: [
      {
        key: 'gencat-agenda', name: 'Agenda Cultural de Catalunya',
        publisher: 'Generalitat de Catalunya. Departament de Cultura',
        dataset_name: 'Agenda cultural de Catalunya', license_name: 'Llicència oberta',
      },
      {
        key: 'ticketmaster-discovery-feed', name: 'Ticketmaster Discovery Feed España',
        publisher: 'Ticketmaster', dataset_name: 'Discovery Feed 2.0 - Events Feed Spain',
        license_name: 'Ticketmaster API / Discovery Feed Terms of Use',
      },
    ] });
    renderRoute('/fonts');
    expect(await screen.findByRole('heading', { name: 'Ticketmaster Discovery Feed España' })).toBeInTheDocument();
    expect(screen.getByText(/no és Open Data/)).toBeInTheDocument();
    expect(screen.getByText(/Ticketmaster encara no està habilitat en producció/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contacte@tenspla.cat' })).toHaveAttribute('href', 'mailto:contacte@tenspla.cat');
  });
});
