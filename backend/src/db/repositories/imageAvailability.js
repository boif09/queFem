// How long an image whose origin answered 404/410 stays hidden before it is offered (and fetched) again.
export const DEAD_IMAGE_RETRY_DAYS = 7;

export function deadImageRetryCutoff(now = new Date(), days = DEAD_IMAGE_RETRY_DAYS) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// SQL: the image is usable (never marked, or marked long enough ago to be tried again). One bind parameter: the cutoff.
export function imageIsAvailableSql(alias = 'psi') {
  return `(${alias}.unavailable_at IS NULL OR ${alias}.unavailable_at <= ?)`;
}
