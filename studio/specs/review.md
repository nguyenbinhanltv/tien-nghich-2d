# Review tab behaviours

- **REVIEW-001** (human-only) A listening sign-off is recorded only by a browser page, only for the exact master that was heard; a changed master reads as stale.
- **REVIEW-002** (human-only) No MCP code can reach the sign-off or review routes.
- **REVIEW-003** (human-only) A regenerated master drops back to waiting, whether its old verdict was a sign-off or an approval from before the studio.
- **REVIEW-004** (human-only) A VFX 1x readability read is a human read; an agent cannot post one.
- **REVIEW-005** Art approved on record covers a frame only while the file still hashes to the recorded bytes; an added file breaks coverage.
