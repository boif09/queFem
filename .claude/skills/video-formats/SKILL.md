---
name: video-formats
description: Use when planning, structuring, or critiquing a short-form video's scene structure. Local TensPla copy trimmed to two scene grammars — TimelineExplainer (numbered beats, e.g. "5 plans") and TitledVideo (existing clip + title/end cards). Methodology only; no rendering engine.
---

# Video Formats

> **Local copy (TensPla):** trimmed from scrollmark/social-skills. Only the
> `timeline-explainer` and `titled-video` grammars are included, and all
> references to the upstream `video-studio` engine, generators, providers and
> render tooling were removed. See `.claude/skills/PROVENANCE.md`.

The format grammars live in `references/formats/` — this skill tells you what a format is and which one to reach for.

## What a Format Is

A format is a **scene grammar**: a repeatable structure that says how many scenes a video has, what each one is for, what goes in each one, and what questions to ask before you can build it. It is not a template to fill in and not a style preset. Two videos in the same format can look nothing alike and still be the same shape.

Every format file has the same five sections:

- **Composition** — aspect ratio, frame rate, scene count and lengths, whether captions are on.
- **Interview** — the questions to ask before planning.
- **Slots** — the named assets the format needs. Slots are the shopping list.
- **Grammar** — the scene-by-scene construction rules. This is the load-bearing section: which beat opens, how long each runs, what belongs on screen at once, and what the format refuses to do.
- **Render notes** — the practical traps, learned by failing.

## Choosing a Format

| Format | The question that selects it |
|---|---|
| **TitledVideo** | Do you have a finished clip that just needs titles to be postable? |
| **TimelineExplainer** | Is the *list* the point — numbered beats the viewer counts along with? |

## Reading a Format File

Load `references/formats/{name}.md` from this skill's own directory: `timeline-explainer.md` or `titled-video.md`.

Every format file carries frontmatter above its prose — `aspect`, `alsoWorks`, `scenes`, `sceneSeconds`, `captions`, `narration`. A key a format does not state is absent rather than guessed, and the prose stays authoritative.

The files share a vocabulary:

- A **scene** holds `narration` and a stack of **layers**; a layer is a `source` (footage or a still), a `card` (live typography), or an `effect`.
- **`card`** — real typography rendered at composition time. Every exact word, number, name, year, and URL is a card. Never ask an image generator for text; it invents letterforms.
- **`ken`** — a slow Ken Burns drift over a still, so it reads as footage rather than a frozen frame. Alternate zoom direction and pan between consecutive scenes or the cuts all move identically.
- **`rect`** — a layer's position as `[x, y, w, h]` in fractions of the frame. **`atMs` / `untilMs` / `pop`** — its visibility window inside the scene, with an optional pop-in.
- **`plannedSeconds`** — an estimate. Measured narration length is the real clock.

## Anti-patterns

- **Two ideas in one scene.** If a beat needs two sentences, it's two beats.
- **Card and narration saying the same words.** The card carries the short form, the voice carries the sentence. Doubling reads as a caption, not a design.
- **Mixing formats mid-video.** A video that changes grammar halfway through has no grammar; it has two halves.
- **Choosing a format by look.** Formats are selected by what the material *is*. Look is a separate layer entirely.

## Grammar rule worth keeping

**The Grammar section must be able to say no.** A grammar that only describes what a video may contain isn't a grammar. Each format forbids something specific. If a proposed variant forbids nothing, it's a mood board.
