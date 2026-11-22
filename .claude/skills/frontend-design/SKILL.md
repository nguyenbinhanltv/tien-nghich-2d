---
name: frontend-design
description: Wrapper for the cloned Anthropic frontend-design skill. Use for the visual direction of the Pixel Studio UI (studio/ui) and the existing preview-app. Guidance only; the UI stays zero-build ES modules, local fonts, English + Vietnamese.
---

# frontend-design (wrapper)

The real skill: `tools/skills/anthropic-skills/skills/frontend-design/SKILL.md` (clone `anthropic-skills`, pinned in `docs/SKILLS_INSTALLED.md`; Apache-2.0). It is a single instruction file with no scripts. Read it before starting a new studio screen or restyling an existing one.

## How this project uses it
1. Ground the design in the subject: a pixel-art workshop for a xianxia roguelite. Take cues from ink, bronze and jade, not from generic dashboard defaults. The 43-colour palette (`tools/generators/palette.json`) and `docs/ART_BIBLE.md` are the colour source for UI chrome too.
2. Pixel art must stay crisp: `image-rendering: pixelated`, integer zoom levels, no smoothing or blur on sprites.
3. Constraints override the skill: plain ES modules and CSS, no bundler, no framework, no build step. No CDN fonts or remote assets, because the studio runs offline on loopback; use system or locally committed fonts.
4. Every visible string goes through the English/Vietnamese switch. Check that Vietnamese diacritics render with the chosen typeface and that labels survive the longer Vietnamese text.
5. Human-only actions (approve, sign listening, publish) stay visually distinct and live only in the UI.
6. Verify with the existing browser tests; do not treat a screenshot alone as acceptance.

Pipeline stage: studio UI (P1).
