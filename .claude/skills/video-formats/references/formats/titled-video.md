---
name: titled-video
title: TitledVideo
description: Clip plus a typography package
aspect: source
captions: optional
---

# TitledVideo — clip + typography package

An existing (or generated) clip dressed with title/end cards and section
labels — the "make this clip postable" format.

## Composition
Match source clip's orientation. Layers:
`main` clip full-frame; title card scene first (2-3s, text on color or
frame-grab background); optional corner section labels; end card with CTA.

## Interview
Round 1 — header "Source": The clip: supply file / URL / generate?
Round 2 — header "Text": Exact title, section labels (if any), end-card CTA
text. (Exact text — it renders as real typography.)
Round 3 — header "Style": Color accent + font vibe (clean/bold/playful)?
Round A — header "Audio": Music (licensed file / none)? Voice (narration
recording / none)? State the rights terms of any music before choosing it.
Round L — header "Look": Which caption/card style (the brand card design)?
Freeform: platform, whether captions are wanted over the clip.

## Slots
`main` clip, `title`, optional `labels[]` with timestamps, `cta`.

## Grammar
Title card ≤6 words. Labels appear at content transitions (the clip's scene
cuts). End card holds 3s minimum.

## Render notes

If the source is a still (or a very short clip held long), give it a `ken`
drift so it reads as footage rather than a frozen frame.
This format is pure composition — usually zero generation cost.
