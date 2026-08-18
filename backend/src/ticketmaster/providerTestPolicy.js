// Explicit provider artifacts observed and manually reviewed. Do not infer test
// records from title text: new IDs require a separate review and code change.
const EXCLUDED_PROVIDER_TEST_IDS = new Set(['Z698xZ2qZ1kqe-F3f']);

export function isExcludedProviderTestRecord(record) {
  return EXCLUDED_PROVIDER_TEST_IDS.has(String(record?.eventId || ''));
}
