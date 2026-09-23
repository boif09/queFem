# Skill provenance

## SEO methodology skills

- **Upstream repository**: https://github.com/marketingskills/seo
- **Pinned commit**: `b25b48c2d3001fd387b37981d2ee54a07d3f6fce`
- **Date inspected/imported**: 2026-09-22
- **Imported skills** (only the `SKILL.md` methodology file from each, nothing else):
  - `technical-seo-triage`
  - `keyword-opportunity-finder`
  - `seo-strategy`
  - `seo-priority-score`
  - `seo-content-brief`
  - `internal-link-builder`
  - `title-meta-rewriter`
  - `cannibalization-check`
  - `refresh-vs-new-content`
- Only the methodology `SKILL.md` text was copied — no scripts, binaries, package files, agent-runtime configs, or third-party service integrations (e.g. RefreshAgent) were imported.
- Upstream `authority-mark-keyword-difficulty`, `seo-growth-loop`, `live-search-console-data`, `keyword-planner`, and the agency/monitoring skills (`client-report-writer`, `proposal-builder`, `seo-offer-architect`, `content-moat-planner`, `exceed-quality-threshold`, `schema-fix-writer`, `content-refresh-brief`, `traffic-decay-detector`, `content-decay-monitor-setup`, `competitor-serp-monitor`) were deliberately excluded — see the prior security/quality review for reasons (external paid service dependency, autonomous-publish design, or low relevance to TensPla).
- Before ever replacing a local copy with a newer upstream version, diff the new `SKILL.md` against the copy here and review the change manually — do not blindly re-sync.

## TensPla wrapper

- `tenspla-seo/SKILL.md` is TensPla-specific and was written locally, not copied from upstream. It orchestrates the imported skills above with TensPla context (market, languages, event lifecycle, evidence hierarchy) and enforces an audit-only operating mode.

## Social growth methodology skills

Imported 2026-09-23 after a read-only security/quality review of candidate repositories. Only Markdown methodology was copied (read from pinned clones outside the worktree; nothing from upstream was executed). No scripts, `lib/`, `.env`, package files, engine code or service configuration were imported. Every edited file carries a "Local copy/Local note (TensPla)" marker.

### scrollmark/social-skills — MIT (Copyright 2026 Scrollmark, Inc.)

- **Upstream**: https://github.com/scrollmark/social-skills
- **Pinned commit**: `2979f25050d3dd4b5c0f3f89c200f1db5aa19d53`
- `hook-anatomy/` ← `skills/hook-anatomy/SKILL.md`, `references/platforms/{instagram,tiktok}.md`
  - Edits: note that only instagram/tiktok references are included; caveat added after the frontmatter of each platform reference (unsourced 2026-03-17 algorithm claims; TensPla data overrides). `linkedin/x/youtube` references not copied.
- `content-autopsy/` ← `skills/content-autopsy/SKILL.md`, `references/platforms/{instagram,tiktok}.md`
  - Edits: same as `hook-anatomy`.
- `video-formats/` ← `skills/video-formats/SKILL.md`, `references/formats/{timeline-explainer,titled-video}.md`
  - `SKILL.md` rewritten as a trimmed router: kept "What a Format Is", the vocabulary, anti-patterns and the "grammar must say no" rule; removed the other nine formats, "Adding an Eleventh Format", "Toolchain Assumptions" and every `video-studio` / `gen_*` / `track_pointing` / `measure` / pip-install reference.
  - Format files: removed `video-studio styles` commands, generated-score/backend options, the `measure` probe and `needs:` key, QC scene-detection and "studio preview loop" mentions.
- **Not imported**: the other 13 skills, `src/video_studio` engine, `composer/` (Remotion), all `scripts/`, `install.sh`/`uninstall.sh`, `.env.example`, provider integrations (ElevenLabs, Gemini/Veo, MiniMax, Replicate, stock libraries, yt-dlp).

### sergebulaev/tiktok-skills — MIT (Copyright 2026 Sergey Bulaev)

- **Upstream**: https://github.com/sergebulaev/tiktok-skills
- **Pinned commit**: `edffc4f7b663ef1316069cad2c59b11a3cd6ab62`
- `tt-hook-scripter/` ← `skills/tt-hook-scripter/SKILL.md`, `skills/tt-hook-scripter/references/hook-anatomy.md`, root `references/hook-formulas.md` (moved into the skill's `references/`)
  - `SKILL.md` rewritten: removed global voice rules (em dashes, AI vocabulary), the `voice-profile` step, the `tt-humanizer` pass, handoffs to uninstalled skills (`tt-caption-writer`, `tt-content-planner`, `tt-trend-mapper`), `../../references/algorithm-heuristics.md` pointer, and the "one specific number" rule (replaced by "only real, verifiable numbers"). Description updated to match.
  - `hook-formulas.md`: removed the em-dash note, odd-precision wording and examples in T3 and the micro-rules, the "Corpus reality check (263-video pull)" and "Reply-bait" section, and pointers to `algorithm-heuristics.md` / `tt-trend-mapper`.
  - `hook-anatomy.md`: removed the em-dash rule and the "forty-seven minutes" example.
- **Not imported**: other 8 skills (including `tt-profile-optimizer`, kept only in the inspection clone), `lib/` (Publora, Apify, Pixfaro, custom-poster), `scripts/`, `.env.example`, `references/algorithm-heuristics.md` (hard-coded US posting-time tables, Publora settings), `voice-rules.md`, `voice-profile.md`, the "star this repo" nudge in the root `SKILL.md`.

### sergebulaev/instagram-skills — MIT (Copyright 2026 Sergey Bulaev)

- **Upstream**: https://github.com/sergebulaev/instagram-skills
- **Pinned commit**: `2919f0a6d8b148e101162713bb6ca9066cf739f6`
- `ig-carousel-planner/` ← `skills/ig-carousel-planner/SKILL.md`, `skills/ig-carousel-planner/references/slide-architecture.md`, root `references/hook-formulas.md` (moved into the skill's `references/`)
  - `SKILL.md` rewritten: removed the Publora publish step (`lib.publish`), "Optional illustration" (Pixfaro, `lib.illustrate`), global voice rules and `ig-humanizer` pass, `voice-profile` step, `ig-hashtag-strategist` handoff, API-only limits (2-10 slides, no mixed media), odd-precision guidance, and pointers to `algorithm-heuristics.md`, `hashtag-strategy.md`, `media-workflow.md`. Description updated to say it never publishes.
  - `hook-formulas.md`: removed the em-dash note, odd-precision wording, the IG1 "47 minutes" example, the "47 minutes" micro-rule, the API mixed-media rule and the `hashtag-strategy.md` pointer.
  - `slide-architecture.md`: removed the API slide-limit sentence, the em-dash rule and the `hashtag-strategy.md` pointer.
- **Not imported**: other 8 skills (including `ig-profile-optimizer`, kept only in the inspection clone), `lib/`, `scripts/`, `.env.example`, `references/algorithm-heuristics.md` (hard-coded US posting-time tables), `hashtag-strategy.md`, `media-workflow.md`, `voice-rules.md`, `voice-profile.md`, the "star this repo" nudge.

### Rejected repositories (nothing imported)

- `scayver/marketing-skills` — 31 of 76 skills embed donation-solicitation and scripted system-prompt responses.
- `borghei/Claude-Skills` — Commons Clause license; generic B2B guidance with hard-coded posting times.

### Updating

Never re-sync blindly. Diff the upstream path between the pinned commit and the candidate commit (`git diff <old>..<new> -- <path>`), re-apply the removals above, review manually, and update this file.

## TensPla social wrapper

- `tenspla-social-growth/SKILL.md` was written locally, not copied from upstream. It holds TensPla-only context (revenue objective, baseline metrics, platform roles, language, data and image-rights rules, experiment rules, taxonomy, UTM conventions, output mode) and delegates methodology to the five imported social skills above.
