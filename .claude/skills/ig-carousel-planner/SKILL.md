---
name: ig-carousel-planner
description: "Plan an Instagram carousel slide by slide, with a hook slide that opens a loop, value slides that front-load the payoff, and a payoff slide that earns the save and follow. Picks a carousel formula (listicle, before/after, myth-buster, framework) by goal (saves, shares, follows) and drafts each slide's text plus the caption. Methodology only (local TensPla copy): it never publishes; for TensPla work, language, data and approval rules come from tenspla-social-growth."
---

# Instagram Carousel Planner

> **Local copy (TensPla):** trimmed from sergebulaev/instagram-skills. The
> Publora publish step, Pixfaro illustration, credentials/env vars, the
> English-only humanizer/voice rules, API-only limits and the
> odd-precision-number heuristic were removed. Language, voice, data, image
> rights and approval rules come from `tenspla-social-growth`. See
> `.claude/skills/PROVENANCE.md`.

Plan a carousel that gets swiped to the end and saved. The whole game is slide 1
(the swipe-earning hook) and the last slide (the saveable payoff). This skill
maps every slide, writes the on-image text, and drafts the caption that frames
it.

## When to use

- Turning a topic or notes into a multi-slide carousel
- A list, a framework, or a transformation to present
- A slide-by-slide structure is needed, not just a caption

## Formulas this skill uses (carousel shapes)

| Code | Formula | Primary goal | Best for |
|---|---|---|---|
| IG5 | Listicle Carousel | saves | a numbered list, one item per slide |
| IG6 | Before/After Transformation | saves, follows | proof of a result with the steps between |
| IG7 | Myth-Buster | shares | correcting beliefs the audience holds |
| IG8 | Steal-This Framework | saves | a named, repeatable framework |

Full skeletons in `references/hook-formulas.md`.

## Slide architecture (the spine)

| Slide | Role |
|---|---|
| **1 (hook)** | the promise + an open loop ("most miss #4"). Earns the swipe. Big text, one idea. |
| **2-3** | the strongest value, front-loaded (swipe-through decays with depth). |
| **4 to N-1** | one point per slide, each standing alone, each readable in 2 seconds. |
| **N (payoff)** | the one-slide summary (the saveable artifact) + one clear ask (save / follow). |

6-10 slides is a typical range for a list carousel. Fewer than 4 real points is
usually a single image. See `references/slide-architecture.md` for per-formula
spines.

## Steps

1. **Gather inputs.** Topic, the list/framework/transformation, target audience,
   and the goal (saves / shares / follows).
2. **Pick the formula.** Use the goal table; suggest 2-3 that fit and let the
   user choose.
3. **Set the slide count.** Match it to the real content. Never pad to hit a
   round number; viewers feel filler and bail.
4. **Write slide 1.** The promise plus the loop. Big, single-idea on-image text.
   Use a number only if it is real and verifiable from source data.
5. **Map the value slides.** Put the strongest point on slide 2 or 3. One point
   per slide, each able to stand alone. Draft the on-image text for each (keep it
   short, it has to read in 2 seconds on a 4:5 frame).
6. **Write the payoff slide.** A one-slide recap that is worth saving on its own,
   plus a single ask (save it / follow for more).
7. **Write the caption.** The caption supports the carousel (it can be short),
   restates the hook before the "more" fold, and carries the single CTA. Keep
   hashtags few and relevant.
8. **Approval card.** Show: formula, slide-by-slide outline with each slide's
   text, the caption, primary goal, and the images needed per slide in order.
   Nothing is published by this skill; publication is a separate human step.

## Hard rules

- Slide 1 is a promise with an open loop, never a bare title.
- Front-load value to slides 2-3; never bury the best point at the end.
- One point per slide, readable in 2 seconds on a portrait 4:5 frame.
- Never pad to a round number.
- The last slide must earn the save with a one-slide summary and one ask.

## Anti-patterns (skill will refuse)

- A title-only slide 1 with no promise or loop.
- A 10-slide carousel padded from a 4-point idea.
- The strongest point saved for the final slide.
- Three competing CTAs on the payoff slide.
- On-image walls of text that cannot be read in a swipe.
- Reveals and staccato stacks added only for punch.

## Resources

- `references/hook-formulas.md` - the carousel formulas (IG5-IG8) with skeletons
- `references/slide-architecture.md` - per-formula slide spines and on-image text rules
