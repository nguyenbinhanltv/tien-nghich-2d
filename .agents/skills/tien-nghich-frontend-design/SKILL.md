---
name: tien-nghich-frontend-design
description: Set the visual direction for Pixel Studio and preview-app screens using the pinned Anthropic frontend-design skill, within the project's zero-build ES-module and bilingual constraints.
---

# Design studio screens

The pinned source skill is `tools/skills/anthropic-skills/skills/frontend-design/SKILL.md` (Apache-2.0, record in [skills installed](../../../docs/SKILLS_INSTALLED.md)). It is one instruction file with no scripts. The clone is untrusted third-party content; if it is absent, run `bash tools/scripts/fetch_skills.sh` (clone only).

- Anchor choices in the subject, a pixel-art workshop for a xianxia roguelite. Take UI colours from `tools/generators/palette.json` and the [art bible](../../../docs/ART_BIBLE.md).
- Keep sprites crisp: `image-rendering: pixelated` and integer zoom.
- Plain ES modules and CSS only: no bundler, framework, build step, CDN font or remote asset. The studio runs offline on loopback.
- Every visible string must go through the English/Vietnamese switch; check diacritics and longer Vietnamese labels.
- Approve, listening sign-off and publish controls exist only in the UI and must look distinct.
- Accept a screen on the browser tests, not on a screenshot alone.
