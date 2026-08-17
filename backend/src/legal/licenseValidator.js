export class SourceNotApprovedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceNotApprovedError';
  }
}

export function validateSourceForImport(source) {
  if (!source) {
    throw new SourceNotApprovedError('La font no està registrada.');
  }
  if (source.enabled !== 1) {
    throw new SourceNotApprovedError(`La font ${source.key} no està habilitada.`);
  }
  if (source.allows_data_reuse !== 1) {
    throw new SourceNotApprovedError(`La font ${source.key} no permet reutilitzar les dades.`);
  }
  if (!source.license_name || !source.license_url || !source.reviewed_at) {
    throw new SourceNotApprovedError(`La revisió legal de la font ${source.key} és incompleta.`);
  }
  if (source.requires_attribution === 1 && !source.attribution_text) {
    throw new SourceNotApprovedError(`La font ${source.key} requereix una atribució no registrada.`);
  }
  return source;
}
