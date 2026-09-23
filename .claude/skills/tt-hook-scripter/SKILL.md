---
name: tt-hook-scripter
description: "Script the first 1-3 second TikTok hook: the spoken line, the on-screen text, and the opening visual firing at once so the viewer cannot swipe. Picks a hook formula (cold-open result, pattern interrupt, number reveal, open-loop question, relatable call-out, story) by goal of completion, saves, comments, or shares. Use to script a hook from a video idea. Methodology only (local TensPla copy); for TensPla work, language, data and approval rules come from tenspla-social-growth."
---

# TikTok Hook Scripter

> **Local copy (TensPla):** trimmed from sergebulaev/tiktok-skills. Publishing,
> Publora, credentials, the English-only humanizer/voice rules, and the
> odd-precision-number heuristic were removed. Language, voice, data and
> approval rules come from `tenspla-social-growth`. See
> `.claude/skills/PROVENANCE.md`.

Write the first 1 to 3 seconds of a TikTok video: the spoken line, the on-screen
text, and the opening visual, all firing at once. TikTok's ranker leans heavily
on watch time, and a viewer decides to stay or swipe before second three. If the
hook does not win, nothing downstream gets watched.

## When to use

- A video idea needs an opening that stops the scroll
- Videos "die in the first second" and need a stronger open
- Picking a proven hook shape and filling it with the account's own angle
- Before recording narration, to lock the spoken line and the on-screen text

## What this skill produces

For one video idea, a ready-to-produce hook block:

- **Spoken line** (the narration in the first 1-3 seconds)
- **On-screen text** (the muted-first promise, 3 to 7 words)
- **Opening visual** (what is in frame one: result, tension, or interrupt)
- **The formula used** and its primary goal
- **A loop-close note** (how to end the video so it restarts for a rewatch)

It does not write the caption or the full body script beat-by-beat unless asked;
it locks the open, which is where retention is won or lost.

## Formulas this skill uses

| Code | Formula | Primary goal | Best for |
|---|---|---|---|
| T1 | Cold-Open Result | completion | show the finished outcome first, promise the how |
| T2 | Pattern Interrupt | completion | break the expected frame so the thumb stops |
| T3 | Specific-Number Reveal | saves | one concrete, verifiable number that reframes the topic |
| T4 | Open Loop Question | comments | ask the exact question the video answers |
| T5 | Relatable Call-Out | shares | a hyper-specific shared moment worth sending |
| T6 | Bold Claim, No Hedge | comments | a flat contrarian claim the comments will argue |
| T7 | Listicle Promise | saves | a numbered payoff with on-screen counters |
| T8 | Story In Medias Res | completion | drop into the peak of a real story |
| T9 | Tutorial Cold Start | saves | start step one with the result previewed |
| T10 | Trend-Ride With A Twist | shares | a trending sound bent to your niche |

Full skeletons (three layers each) in `references/hook-formulas.md`.

### Pick by goal first

| Goal | Reach for |
|---|---|
| Completion | T1, T2, T8 |
| Saves | T3, T7, T9 |
| Comments | T4, T6 |
| Shares | T5, T10 |

## Steps

1. **Gather inputs.** The video idea, the niche/audience, the one promise the
   video delivers, and the goal (completion / saves / comments / shares).
2. **Pick the formula.** Use the goal table to shortlist, then suggest 2-3 that
   also fit the idea and let the user choose. For a trend ride (T10), check the
   trend actually fits the niche first.
3. **Write all three layers.** Spoken line, on-screen text, opening visual. The
   spoken line and the on-screen text MUST differ (muted-first viewing).
   - The result or the tension is in frame one. No greeting, no logo, no zoom.
   - A concrete number helps only when it is real and verifiable from source
     data (a count, a price, a date). Never invent or "sharpen" a figure.
   - Say it the way a person talks; read it out loud.
4. **Write the loop-close note.** How the last frame should land so a rewatch
   feels natural.
5. **Approval card.** Show: formula, the three layers, primary goal, the
   loop-close note, and an estimated hook duration. Nothing is published by this
   skill; publication is a separate human step.

## Hard rules

- The hook is the first 1-3 seconds of the **video**, not the caption. Never let
  the caption do the hook's job.
- The spoken line and the on-screen text are two different jobs. Do not repeat the
  same words in both.
- Frame one shows something (result, tension, interrupt). No dead air, no intro.
- The hook opens the loop; it never answers itself.

## Anti-patterns (skill will refuse)

- Greeting openers ("hey guys" / "welcome back" / "in this video" and their
  equivalents in any language).
- A logo animation or slow zoom before the words start.
- Reading the caption aloud as the hook.
- Promising a result the video never shows on screen.
- ALL CAPS spoken scripts.
- A staged punch line inserted only for rhythm.
- Five stacked calls to action.

## Resources

- `references/hook-formulas.md` - all 10 TikTok hook formulas (three layers each)
- `references/hook-anatomy.md` - the three-layer hook teardown and timing budget
