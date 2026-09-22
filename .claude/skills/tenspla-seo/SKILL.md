---
name: tenspla-seo
description: Coordinate an evidence-driven, audit-only SEO/growth review for TensPla (tenspla.cat), a Catalonia event/activity discovery platform. Use when the user asks for an SEO audit, traffic diagnosis, or growth opportunity analysis for TensPla. Delegates methodology to the installed technical-seo-triage, keyword-opportunity-finder, seo-strategy, seo-priority-score, seo-content-brief, internal-link-builder, title-meta-rewriter, cannibalization-check, and refresh-vs-new-content skills; does not reimplement their logic.
---

# TensPla SEO Audit

## Scope: AUDIT ONLY

This skill produces findings and recommendations. It never implements them.

Never, under this skill:
- Modify application code, content, or configuration.
- Commit, push, or open a PR.
- Deploy or touch production.
- Connect to Search Console, GA4, or any third-party SEO/data service (no live API integrations, no RefreshAgent or similar proxy).
- Automatically publish, index, or submit anything.

Implementation of any recommendation is always a separate, explicitly authorized task, subject to this repository's own `AGENTS.md` operating rules (no autonomous commits/deploys/production access).

## Site context

- Public site: https://tenspla.cat
- Market: Catalunya
- Primary language: Catalan; secondary: Spanish (both must stay fully supported — never propose a fix that favors one language at the expense of the other)
- Product: dynamic event/activity discovery, sourced from Gencat, DIBA, Ticketmaster, Fever, and others (see `docs/DATA_SOURCES.md`)
- Event-detail pages are naturally short-lived (events expire/get removed); evergreen discovery pages can accumulate authority over time
- Google Search Console is active for the site
- The product already works; the current priority is qualified organic traffic, not new features or new data sources

**Do not treat all event-detail URLs as SEO noise or default to recommending noindex for them.** Individual event pages can legitimately rank for event-specific searches. Growth strategy should emphasize durable discovery/landing pages where evidence (Search Console data, search intent, competitive gaps) actually supports it — not by assumption.

## Areas this audit must explicitly examine

1. **CA/ES multilingual behavior**: hreflang correctness, canonical behavior across language variants, possible bilingual cannibalization (same content ranking against itself in two languages).
2. **Dynamic event lifecycle**: sitemap freshness, handling of expired/removed events, redirect/404/410 behavior for gone events.
3. **Structured data**: schema.org `Event` presence, correctness, and consistency with what's actually visible on the page (no markup describing data that isn't shown).
4. **Evergreen discovery architecture**: investigate — do not assume — opportunities such as territorial pages (municipality/province/comarca), "today," "this weekend," family/children plans, free plans, and category pages (exhibitions, concerts). Reject any combination that would produce thin or duplicate content without real user value; programmatic SEO is only acceptable where it serves a genuine, distinct search intent.

## Evidence hierarchy

When evidence conflicts, prioritize in this order:

1. Real Google Search Console data (from exports the user supplies — see below)
2. Actual indexed/public site behavior (live crawl or search results)
3. Current search results / search intent
4. Repository implementation (routes, sitemap generation, canonical logic, etc.)
5. Generic SEO best practice

Generic SEO assumptions must never override contradictory real TensPla or GSC evidence.

## Search Console data

For this audit, expect the user to supply manually exported Search Console CSV/XLSX files (Queries, Pages, Coverage, etc.). Do not attempt to connect to Search Console, GA4, or any third-party GSC proxy (e.g. RefreshAgent) — live integrations are a separate decision to be made explicitly later, not something this skill sets up.

## Workflow

1. **Repository/code audit**: read the relevant routing, sitemap, canonical, and structured-data code in `frontend/` and `backend/src/`. Check `docs/ARCHITECTURE.md` and `docs/DATA_SOURCES.md` for how event lifecycle and sources are actually implemented, rather than assuming.
2. **Public-site sample check**: when asked to, inspect a small sample of real pages (homepage, a couple of evergreen/category pages, a couple of event-detail pages) for indexability, title/meta, canonical, and structured data.
3. **Search Console evidence**: analyze whatever exports the user provides. If none are provided, say so explicitly and lower confidence accordingly rather than fabricating numbers.
4. **Methodology skills**: apply the installed skills for their respective jobs — `technical-seo-triage` for crawl/index/canonical/schema/link issues, `keyword-opportunity-finder` and `seo-content-brief` for keyword/intent gaps, `internal-link-builder` for link structure, `title-meta-rewriter` for CTR opportunities, `cannibalization-check` for query/page overlap (including CA/ES bilingual cases), `refresh-vs-new-content` for the update/consolidate/prune/create decision, `seo-strategy` for the overall frame, and `seo-priority-score` to rank everything that comes out of the above.
5. **Synthesize**, don't list everything the methodology skills surface — cut to the output contract below.

## Output contract

The final audit must not be a large checklist. Return **at most 10 recommended actions**, each categorized:

- **P0** — blocks or seriously harms organic acquisition
- **P1** — strong traffic opportunity
- **P2** — useful but lower priority

For every action, include:
- Evidence (which data or observation supports it)
- Why it matters specifically for TensPla (not a generic SEO reason)
- Expected traffic impact
- Confidence
- Estimated implementation effort
- Metric/KPI to monitor afterward

The optimization target is **qualified organic visits**, not an abstract SEO score or checklist completeness.
