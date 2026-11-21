---
name: webapp-testing
description: Wrapper for the cloned Anthropic webapp-testing skill. Use to plan browser tests of the Pixel Studio UI and preview-app (Playwright, screenshots, console logs). Playwright is not installed here and its with_server.py helper is not run; read it for patterns first.
---

# webapp-testing (wrapper)

The real skill: `tools/skills/anthropic-skills/skills/webapp-testing/SKILL.md` (clone `anthropic-skills`, pinned in `docs/SKILLS_INSTALLED.md`; Apache-2.0). It has `scripts/with_server.py` and three example scripts. Third-party and untrusted: read, do not execute from inside the clone.

## How this project uses it
1. Use its reconnaissance-then-action pattern: load the page, wait for `networkidle`, take a screenshot or inspect the DOM, then pick selectors from the rendered state. Capture console logs and page errors on every run.
2. Playwright is **not** installed and the project forbids ad-hoc installs. Until a venv with Playwright is approved, the baseline browser checks stay `node preview-app/smoke-test.mjs` and `node --test preview-app/server/editor.test.mjs`. Do not install Playwright to finish a task; report that it is unavailable.
3. Do not run `scripts/with_server.py`: it launches commands with `shell=True`. Start the studio server yourself, loopback only (`127.0.0.1`), and stop it when the run ends.
4. If Playwright is approved later, run any copied script with `python -I` from a scratch directory outside the clone, point it at `http://127.0.0.1:<port>/`, and write screenshots to a temp directory, not the repository.
5. A new test goes next to the code it covers and runs in the baseline checks.

Pipeline stage: studio UI verification (P1 onward).
