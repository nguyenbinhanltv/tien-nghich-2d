# Review tab behaviours

- **REVIEW-001** (human-only) A listening sign-off is recorded only by a browser page, only for the exact master that was heard; a changed master reads as stale.
- **REVIEW-002** (human-only) No MCP code can reach the sign-off or review routes.
- **REVIEW-003** (human-only) A regenerated master drops back to waiting, whether its old verdict was a sign-off or an approval from before the studio.
- **REVIEW-004** (human-only) A VFX 1x readability read is a human read; an agent cannot post one.
- **REVIEW-005** Art approved on record covers a frame only while the file still hashes to the recorded bytes; an added file breaks coverage.
- **REVIEW-006** A new take (a saved revision or a candidate) never changes which take is selected or in use: newest, selected and in the game are three separate facts, shown separately.
- **REVIEW-007** (human-only) A take or a candidate is selected only by a person, through the Review tab's same-origin route; no MCP tool can select, and a candidate run changes nothing in use.
- **REVIEW-008** Candidates that fail the pixel gates are rejected before a person sees them; the survivors are stored as takes and laid on one contact sheet beside the reference.
- **REVIEW-009** A change request is pinned to a revision hash, a frame and a box, is append-only, and is answered only by a later revision that lists its id; asking for review again is refused while one has no answer.
