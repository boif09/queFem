// Independent local agendas that Tens Pla? recommends with a link. Their plans are never imported.
// An entry needs the owner's written permission (link and logo) and must be free of advertising.
export const LOCAL_AGENDAS = [
  {
    id: 'terrassa-amb-plans',
    municipality: 'Terrassa',
    name: 'Terrassa amb plans',
    url: 'https://terrassambplans.cat/',
    logo: '/images/local-agendas/terrassa-amb-plans.webp',
  },
];

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim()
  .toLowerCase();

export function localAgendaForMunicipality(municipality) {
  const wanted = normalize(municipality);
  if (!wanted) return null;
  return LOCAL_AGENDAS.find((agenda) => normalize(agenda.municipality) === wanted) || null;
}
