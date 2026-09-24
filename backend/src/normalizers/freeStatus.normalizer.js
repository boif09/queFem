// Infers whether a plan is free, paid, or unknown from an optional upstream
// free/paid flag combined with free-text price/admission wording.
//
// Background: Gencat and DIBA each provide free/paid signals that can
// directly contradict each other (Gencat: a separate `gratuita` boolean flag
// vs. free-text `entrades`; DIBA: only free-text `preu`, previously matched
// by a regex that could never match real Catalan spellings of "gratuït").
// This helper is the single place that reconciles a flag with text evidence,
// so no source-specific normalizer re-implements this logic.
//
// Tri-state result, matching plans.is_free:
//   1    = confidently free
//   0    = confidently paid
//   null = unknown / mixed / insufficient evidence
//
// Precedence distinguishes a free SIGNAL COMING FROM THE FLAG (unreliable,
// e.g. Gencat's `gratuita`) from a free signal coming from the TEXT ITSELF:
//   1. An explicit non-zero currency amount in the text means the text
//      itself claims a real price. If some CLAUSE of the text (split on
//      sentence-like punctuation) makes an unconditional-looking free claim
//      that isn't itself qualified by conditional wording in that same
//      clause (e.g. "Entrada gratuïta. Taller opcional: 5 €" — "Entrada
//      gratuïta" is its own unqualified clause, contradicted by a price
//      elsewhere), that is a genuine contradiction within the text itself —
//      not just an unreliable flag disagreeing with a clean price — so the
//      result is unresolved (null), never paid and never free. A conditional
//      word elsewhere in the text, qualifying a *different* clause (e.g.
//      "...Descompte per a socis" after an unrelated "Entrada gratuïta"),
//      must not suppress this — hence the per-clause check rather than a
//      whole-text one. Otherwise (no unqualified free clause at all, e.g.
//      "Tarifa general: 5 euros. Consulteu descomptes i gratuïtats", where
//      the only free-sounding word shares a clause with "descomptes") the
//      price wins: paid, which also overrides an unreliable "flag says
//      free" upstream signal.
//   2. With no positive amount, wording that conditions "free" on a
//      subgroup, membership, eligibility, an included component, or a
//      discount is unresolved (null) — a partial/conditional free mention
//      must never make the whole plan look globally free.
//   3. An explicit "0 €"/"0 EUR" amount, or unqualified "gratuït"/"gratuïta"
//      wording, means free.
//   4. With no usable text signal at all, fall back to the upstream flag.
//
// "Accés lliure" ("free/open access") is deliberately NOT treated as a
// standalone free claim (rule 3): unlike "gratuït", it can describe access
// to only part of an event or venue while a separate paid component exists,
// so on its own it is too ambiguous to assert FREE. It is still recognised
// as a free-SOUNDING signal for rule 1's per-clause contradiction check, so
// that e.g. "Accés lliure a la festa. Amb tiquet: 5 €" resolves to
// unresolved (null) rather than being silently swallowed into paid.

const CURRENCY_AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(?:€|eur\.?)/gi;

// Splits text into rough clauses so a conditional word qualifying one part
// of a sentence doesn't suppress a genuinely separate, unqualified free
// claim elsewhere in the same free-text field. Commas are included (cross-
// review finding: real DIBA/Gencat text often separates clauses with commas
// instead of periods, e.g. "Entrada gratuïta, taller opcional: 5 €, descompte
// per a socis"); a comma also appears inside a decimal amount like "7,70 €",
// but that only creates an extra clause boundary mid-number, which is
// harmless here since amounts are extracted from the whole, unsplit text.
const SEGMENT_SPLIT_RE = /[.,;\n]+/;

// Broad: any free-sounding wording, used only to detect a possible
// contradiction against a real price (rule 1). Narrow ("gratuït" family
// only, see below) is what can actually resolve the result to FREE.
const FREE_WORD_RE = /gratu[iï]ts?a?|acc[eé]s\s+lliure/i;

// Fixes a prior defect: the previous DIBA regex `gratu.it` required a literal
// "it" after a single wildcard character, which no real Catalan spelling of
// "gratuït"/"gratuïta"/"gratuïts"/"gratuïtes" satisfies (confirmed: it never
// matched any of them, accented or not). This correctly matches the accented
// stem plus optional gender/plural suffix. Deliberately excludes "accés
// lliure" — see file header.
const STRONG_FREE_WORD_RE = /gratu[iï]ts?a?/i;

// Includes accented ("inclòs") and gender/plural ("inclosa"/"incloses")
// Catalan forms, membership ("soci"/"carnet de soci"), and common
// eligibility/restriction wording ("per invitació", "per estudiants", "per
// abonats", "per residents", "codi promocional", "per jubilats"/"aturats",
// "primeres N persones", "acreditació") — all confirmed false-positive paths
// during independent cross-review of earlier versions of this regex. This
// list is necessarily not exhaustive — it covers wording confirmed during
// review, not every possible Catalan eligibility phrase; new gaps found
// later should be added the same way.
// "invitaci[oó]" and "acreditaci[oó]" intentionally have no trailing \b: a
// non-unicode-aware \b misbehaves right after an accented character at the
// end of a word (confirmed empirically — \binvitaci[oó]\b failed to match
// "invitació", while \binvitaci[oó] without the trailing boundary matched).
//
// Confirmed real production gaps found during a Phase 4B.3 dry-run audit —
// none of these were caught by the CONDITIONAL_RE above, in production,
// before this patch:
//   "de pagament"    — a mixed free/paid offering stated directly
//                       (e.g. "Hi ha activitats gratuïtes i d'altres que
//                       són de pagament").
//   "abonant"        — free conditional on having paid separately elsewhere
//                       (e.g. "Entrada gratuïta abonant l'entrada del
//                       recinte del Poble Espanyol").
//   "excepte"         — an exception carve-out (e.g. "Entrada gratuïta
//                       (excepte activitats amb preu indicat)"). Broad by
//                       design: it also catches "excepte" used in unrelated
//                       scheduling clauses (e.g. "Tots els diumenges,
//                       excepte l'últim diumenge de mes"), which is an
//                       accepted, deliberate trade-off — the helper cannot
//                       reliably distinguish a pricing exception from a
//                       scheduling one without real NLP, so it conservatively
//                       treats both as unresolved (null) rather than risk a
//                       false FREE on the pricing case.
//   "reserva"          — any reservation requirement, not just "reserva
//                       prèvia" (e.g. "Entrada gratuïta amb reserva
//                       d'entrades").
//   "presentant el/un tiquet/bitllet/carnet/targeta" — a prerequisite item
//                       must be shown.
//   "targeta de soci/club/membre/fidelitat" — a membership/loyalty card
//                       requirement, scoped narrowly so bare "targeta"
//                       (which could mean an unrelated payment card) doesn't
//                       trigger on its own.
//   "disfress-"        — a costume-wearing condition (e.g. "si vens
//                       disfressat").
//   "audiogui-"        — an optional paid add-on named directly (e.g. "en
//                       adquirir l'audioguia").
const CONDITIONAL_RE = /\bper\s*a\b|\bmembres?\b|\bmenors?\b|\binfants?\b|\bincl(?:òs|osa|osos|oses)\b|\bdescompte|\bcarnet\b|\bs[oò]ci(?:a|es|s)?\b|\bamb\s+(?:l['’]?)?entrada\b|\binvitaci[oó]|\bacompanyants?\b|\bestudiants?\b|\babonats?\b|\bresidents?\b|\bpromocional\b|\bjubila(?:t|da|ts|des)\b|\batura(?:t|da|ts|des)\b|\binscripci[oó]\s+pr[eè]via\b|\bprimer(?:a|es)?\s+\d+\s+persones\b|\bacreditaci[oó]|\bde\s+pagament\b|\babonant\b|\bexcepte\b|\breserva\b|\bpresentant\s+(?:el\s+|un\s+)?(?:tiquet|bitllet|carnet|targeta)\b|\btargeta\s+(?:de\s+)?(?:soci|club|membre|fidelitat)\b|\bdisfress|\baudiogui/i;

function normalizeFlag(flag) {
  if (flag === true || flag === 1) return 1;
  if (flag === false || flag === 0) return 0;
  return null;
}

function extractCurrencyAmounts(text) {
  const amounts = [];
  for (const match of text.matchAll(CURRENCY_AMOUNT_RE)) {
    amounts.push(Number.parseFloat(match[1].replace(',', '.')));
  }
  return amounts;
}

function hasUnconditionalFreeClause(trimmed) {
  return trimmed
    .split(SEGMENT_SPLIT_RE)
    .some((segment) => FREE_WORD_RE.test(segment) && !CONDITIONAL_RE.test(segment));
}

export function inferFreeStatus({ flag = null, text = null } = {}) {
  const normalizedFlag = normalizeFlag(flag);
  const trimmed = (text || '').trim();
  if (!trimmed) return normalizedFlag;

  const amounts = extractCurrencyAmounts(trimmed);
  const hasPositiveAmount = amounts.some((amount) => amount > 0);

  if (hasPositiveAmount) {
    if (hasUnconditionalFreeClause(trimmed)) return null;
    return 0;
  }

  if (CONDITIONAL_RE.test(trimmed)) return null;

  if (amounts.some((amount) => amount === 0)) return 1;
  if (STRONG_FREE_WORD_RE.test(trimmed)) return 1;

  return normalizedFlag;
}
