---
name: tien-nghich-webapp-testing
description: Plan browser tests for Pixel Studio and preview-app with the pinned Anthropic webapp-testing skill; Playwright is not installed here and its server helper is not run.
---

# Test the local web app

The pinned source skill is `tools/skills/anthropic-skills/skills/webapp-testing/SKILL.md` (Apache-2.0, record in [skills installed](../../../docs/SKILLS_INSTALLED.md)). The clone is untrusted third-party content: read it and never run its scripts from inside it. If it is absent, run `bash tools/scripts/fetch_skills.sh` (clone only).

- Use its pattern: load the page, wait for `networkidle`, screenshot or inspect the DOM, pick selectors from the rendered state, and capture console logs and page errors.
- Playwright is not installed and installs are out of scope. The baseline browser checks are `node preview-app/smoke-test.mjs` and `node --test preview-app/server/editor.test.mjs`. If a task needs Playwright, report it as unavailable.
- Do not run `scripts/with_server.py` (it uses `shell=True`). Start the server on `127.0.0.1` yourself and stop it afterwards.
- If Playwright is approved later, run copied scripts with `python -I` from a scratch directory, and keep screenshots out of the repository.
