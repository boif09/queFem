// Shared SQL guard: a plan referenced by plan_aliases — as either the alias
// or the canonical side of a historical recurring-production consolidation
// — must never be hard-deleted by ANY purge job. Deleting an alias row would
// silently break the /plans/:oldId redirect it exists to provide; deleting a
// canonical row would violate plan_aliases' own foreign key (aborting that
// purge job's whole transaction, including unrelated legitimate deletions in
// the same batch) and would destroy the one target every alias for that
// group redirects to.
//
// Applied to every raw "DELETE FROM plans WHERE ..." purge path in the
// codebase: event retention (eventRetention.js), outside-Catalonia cleanup
// (cataloniaScope.js), temporal-coherence cleanup (temporalCoherence.js),
// and inactive-plan purge (inactivePlanRetention.js, which uses its own
// per-row is_alias check instead since it already inspects rows individually).
export function planAliasProtectedWhere(alias = '') {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Àlies SQL no vàlid.');
  }
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}id NOT IN (
    SELECT alias_plan_id FROM plan_aliases
    UNION
    SELECT canonical_plan_id FROM plan_aliases
  )`;
}
