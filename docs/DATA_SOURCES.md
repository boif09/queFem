# Data Sources

## Agenda Cultural de Catalunya

Status: ACTIVE
Type: Official Open Data
Commercial reuse: allowed
Attribution: required
Images: do not reuse automatically

Importer:
gencatAgenda.importer.js


## Ticketmaster

Status: DEVELOPMENT ENABLED; PRODUCTION BLOCKED PENDING FINAL LEGAL/TERMS REVIEW
Technical status: IMPLEMENTED AND MANUALLY VALIDATED LOCALLY
Type: Official Discovery Feed 2.0 (not Open Data)
Access basis: Ticketmaster API / Discovery Feed Terms of Use
Scope in Milestone 4A: Spain feed, Catalunya only, 90-day horizon. Accepted observed source identifiers for Ticketmaster-branded official-seller events in the ES feed: `trium` and `mfx-es`, both only when `brandName == "Ticketmaster"` and `officialSeller == true`. `mfx-es` is consistent with official MFX documentation for Spain; no undocumented meaning is assigned to `trium`.
Explicit exclusions: Universe is outside M4A and may be evaluated later as a separate source. `mfx-external` was observed but is intentionally excluded pending clarification. Unknown identifiers are also excluded.

Product/test exclusions in M4A:

- A `| Paquetes VIP` record is excluded only when a matching main event exists with the same normalized base title, local date, local time, municipality and venue.
- An `Upgrade`/`Meet&Greet` record is excluded only when its main event is recognizable in the title and exists on the same local date, municipality and venue.
- Provider test artifacts are never inferred from title text. The manually reviewed event ID `Z698xZ2qZ1kqe-F3f` is explicitly excluded; adding another ID requires a new review.
Images: not downloaded, persisted or displayed
Commercial use: not approved
Redistribution: not approved
Automatic production cron: prohibited until final review
Public transparency: the `/fonts` page identifies Ticketmaster as an official Discovery Feed source, distinguishes it from Open Data, states that images are not reused and makes clear that ticket links lead to Ticketmaster.

Operational validation:

- Dry-run completed without SQLite writes.
- First local import created 71 plans and 71 unique Ticketmaster provenance records.
- A second identical import created no plans or updates, confirming idempotence.
- API results, filters, detail pages and source attribution were manually validated in the local frontend.
- Municipality filters are normalized across accents and municipality takes precedence over comarca when both are supplied, allowing sources that do not provide comarca to participate without inventing one.

Technical retention and removal:

- The importer evaluates a future horizon of 90 days by default (`TICKETMASTER_LOOKAHEAD_DAYS=90`).
- Reconciliation removes Ticketmaster provenance when an accepted event disappears from a complete valid feed. A plan with another source remains; a plan with no remaining source becomes `inactive`.
- `EVENT_RETENTION_DAYS=0` applies to finished events: the general purge does not retain an event once its effective end date is before today.
- Ticketmaster images are neither downloaded nor persisted.
- A manual removal is available as `npm run ticketmaster:remove -- EVENT_ID --dry-run`, followed after review and backup by the same command without `--dry-run`. See `docs/TICKETMASTER_REMOVAL.md`.
- For an approved express request, `--purge --dry-run` previews immediate physical deletion. The real `--purge` removes the plan only if no provenance remains; shared Gencat or other provenance always preserves the plan. The normal seven-day retention remains unchanged when `--purge` is omitted.
- Express correction or removal requests are received at `contacte@tenspla.cat` and have an operational target below 24 hours.
- When removal of the final source changes a plan to `inactive`, `inactive_at` records that transition explicitly. Re-importing an active source reactivates the plan and clears `inactive_at`.
- Internal minimization policy: an `inactive` plan with no `plan_sources` becomes eligible for physical deletion after 7 complete days (`INACTIVE_PLAN_RETENTION_DAYS=7`). Exactly seven days is eligible. This is an internal operational policy, not a legal deadline.
- `npm run purge:inactive -- --dry-run` previews eligible plans without writes. `npm run purge:inactive` deletes their `plan_categories` and then the plan in one transaction; it never deletes shared categories, sources or import runs.
- Legacy inactive plans with `inactive_at IS NULL` are never purged automatically because their transition time cannot be established reliably. They require separate review; the migration does not invent a historical timestamp.

Internal legal flags:

- `allows_data_reuse = true` is the technical importer gate and only represents approved local use inside Tens pla? under the API terms. It does not mean open reuse.
- `allows_transformation = false` records the absence of an open transformation grant. The current validator does not use this flag to block technical normalization into `Plan`.
- `allows_commercial_use = false`.
- `allows_images = false`.

Importer:
`ticketmasterDiscoveryFeed.importer.js`


## Fever

Status: PENDING PARTNER APPROVAL
Integration only through approved API/feed.

DO NOT SCRAPE.


## Surtdecasa

Status: NOT APPROVED
Do not scrape without written permission.


## FemTurisme

Status: NOT APPROVED
Do not scrape without permission.
