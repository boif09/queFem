---
name: tenspla-social-growth
description: Coordinate TensPla (tenspla.cat) Instagram and TikTok growth work — content ideas, hooks, video/carousel structure, post-performance reviews and experiments — optimized for Fever/Impact affiliate revenue, not vanity metrics. Use for any TensPla social media request. Delegates methodology to the installed hook-anatomy, tt-hook-scripter, content-autopsy, video-formats and ig-carousel-planner skills; holds only TensPla context and rules.
---

# TensPla Social Growth

## Scope

Generate, analyze and recommend only. Workflow is always:
**GENERATE → HUMAN REVIEW → HUMAN APPROVAL → NATIVE MANUAL PUBLICATION.**

Never, under this skill: use social publishing APIs, schedule or publish
unattended, use Publora or similar services, scrape competitor accounts, connect
Instagram/TikTok/Meta/Fever/Impact/Umami, or modify application code. Any
implementation (tracking, landing pages, automation) is a separate, explicitly
authorized task under the repository's `AGENTS.md`.

## Objective

Final objective: **revenue**. Optimization hierarchy:

1. Impact/Fever revenue
2. Fever affiliate clicks (`affiliate_click`, see `docs/ANALYTICS.md`)
3. Plan views
4. Qualified social sessions on TensPla
5. Profile visits / link clicks
6. Shares / saves
7. Views
8. Followers — only insofar as they increase distribution

Never optimize a vanity metric independently of the funnel.

## Baseline (23 Sep 2026)

| | Instagram (~30 d) | TikTok (28 d) |
|---|---|---|
| Views | 1,551 plays; 624 unique viewers; 54.3% non-followers | ~5,800 views; 4,100 viewers; 97.1% For You |
| Engagement | 62 interactions | 86 likes, 3 comments, 1 share |
| Profile | 205 profile visits | 46 profile views; 22 followers (+20) |
| Traffic | 9 bio-link clicks → profile → site ≈ 4.4% | video → profile ≈ 1.1%; search ≈ 0.4% |

Samples are small: do not overfit demographics or posting times. Compare new
results against TensPla's own rolling medians, never generic industry benchmarks.

## Platform roles

- **TikTok:** discovery (For You), search, brand recall ("tenspla.cat" said/shown), profile → follow.
- **Instagram:** Reels for discovery; Stories for relationship and conversion (link stickers); bio link; saveable carousels; organizer/event tagging; collaboration posts where useful.

Do not force identical content behavior across both platforms.

## Language

Catalan first. Spanish only when search evidence, audience evidence, or a
deliberate experiment justifies it. Never apply generic English copy heuristics
(English AI-vocabulary lists, em-dash rules, English idioms) to Catalan copy.

## Content data and image rights (hard rules)

- Dates, prices, places and event facts come from TensPla data. No invented statistics or precision.
- Check time-sensitive plans against the current date before recommending them.
- No image may be used in automated social content unless social-media reuse rights are explicitly known for that source. Web-display permission does not imply social reuse. Unknown = not eligible.

## Delegation

| Need | Skill |
|---|---|
| Hook evaluation/generation | `hook-anatomy` |
| TikTok hook structure | `tt-hook-scripter` |
| Post performance analysis | `content-autopsy` |
| Video scene structure ("N plans" → TimelineExplainer) | `video-formats` |
| Instagram carousel structure | `ig-carousel-planner` |

Do not restate their methodology here. Where they conflict with this skill, this skill wins.

## Evidence hierarchy

1. TensPla revenue/funnel data
2. TensPla platform analytics
3. Official Instagram/TikTok documentation
4. Imported methodology skills
5. Generic best practice

Imported heuristics never override real TensPla data.

## Experiment rules

- At most 2 active experiments; one major variable each.
- Never decide from one post; aim for ≥4 observations per variant where practical.
- At current volume, treat differences smaller than ~2× as inconclusive.

## Content taxonomy

Every content item records: `content_id`, `platform`, `pillar`, `format`,
`geography`, `audience`, `intent`, `hook`, `plan_ids`, `has_fever_plans`,
`published_at`.

Pillars: `weekend` · `geography` (outside Barcelona) · `segment` (families / free / music / …) · `seasonal` (festes majors) · `humor` (brand).

## Tracking conventions

Lowercase, hyphenated. Organic social only; never on internal TensPla links.

| Parameter | Value | Example |
|---|---|---|
| `utm_source` | `instagram` \| `tiktok` | `instagram` |
| `utm_medium` | `social` | `social` |
| `utm_campaign` | `{yyyy}w{ww}-{pillar}` | `2026w39-capsetmana` |
| `utm_content` | `{content_id}.{surface}` | `20260925-capsetmana5.story` |

Caption links in Reels/TikTok are not clickable, so attribution there is per
week and surface (bio, story, DM), not per post, unless a dedicated landing path is used.

## Output mode

No large checklists. Answer with:

1. Current objective
2. Evidence
3. Recommended content/action
4. Hypothesis
5. Metric being optimized
6. Experiment design
7. Expected funnel impact
8. What to measure afterward

Always label effects separately as **REACH**, **TRAFFIC** and **MONETIZATION**.
