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
    getComarques: vi.fn(), getMunicipalities: vi.fn(), getCategories: vi.fn(),
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
    expect(screen.getByText('Darrera actualització: 18/08/2026')).toBeInTheDocument();
  });

  it.each([
    ['/privacidad', 'Política de privacidad'],
    ['/almacenamiento', 'Almacenamiento local'],
    ['/contacto', 'Contacto'],
  ])('renders the Spanish alias %s with complete Spanish content', async (route, heading) => {
    await i18n.changeLanguage('es');
    renderRoute(route);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByText('Última actualización: 18/08/2026')).toBeInTheDocument();
  });

  it('states the controller, hosting, minimized logs and retention accurately', async () => {
    await i18n.changeLanguage('es');
    renderRoute('/privacidad');
    expect(screen.getByText(/Xavier Delgado Garcia es el responsable/)).toBeInTheDocument();
    expect(screen.getByText(/Falkenstein, Alemania, zona eu-central/)).toBeInTheDocument();
    expect(screen.getByText(/aproximadamente 14 días/)).toBeInTheDocument();
    expect(screen.getByText(/No registra query strings ni Referer/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Carácter de los datos' })).toBeInTheDocument();
    expect(screen.getByText(/No es necesario facilitar datos personales para navegar/)).toBeInTheDocument();
    expect(screen.getByText(/no vende ni cede datos personales a terceros/)).toBeInTheDocument();
    const privacyEmailLinks = screen.getAllByRole('link', { name: /Escribir a contacte@jusboif.es/ });
    expect(privacyEmailLinks).toHaveLength(2);
    expect(privacyEmailLinks[0]).toHaveAttribute('href', 'mailto:contacte@jusboif.es');
  });

  it('describes language storage without claiming tracking cookies', async () => {
    await i18n.changeLanguage('es');
    renderRoute('/almacenamiento');
    expect(screen.getByText(/localStorage con la clave quefem.language/)).toBeInTheDocument();
    expect(screen.getByText(/no se utiliza para publicidad o perfilado/)).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'contacte@jusboif.es' })).toHaveAttribute('href', 'mailto:contacte@jusboif.es');
  });
});
