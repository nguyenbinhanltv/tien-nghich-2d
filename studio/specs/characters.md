# Characters tab behaviours

- **CHARACTERS-001** The tab shows only characters of the configured categories; bad ids, unknown ids and non-characters are refused.

## Spritesheet importer

Reached from the Characters and Objects tabs; one PNG sheet becomes the frames of one clip and one direction of one asset.

- **CHARACTERS-020** The grid is cut left to right, top to bottom from an offset with spacing; the page draws it with the same arithmetic the server cuts with.
- **CHARACTERS-021** A dry run says what would happen for every frame and writes nothing; the import writes new frames as raw frames with provenance (tool, prompt text, sheet hash).
- **CHARACTERS-022** (human-only) A frame that exists gets a new pending revision and keeps its old pixels; the importer cannot approve anything.
- **CHARACTERS-023** Replace starts at frame 0, append after the last frame; a clip that would overflow is refused with the reason.
- **CHARACTERS-024** A wrong cell size or any cell that breaks the pixel gates (size, palette, binary alpha, outline) refuses the whole import with the reason and writes nothing; the pixelise step is offered.
- **CHARACTERS-025** (staging) Nothing is written into a shipped directory: a shipped asset changes only through revisions, and frames that do not exist yet cannot be added to it.
- **CHARACTERS-026** The import route takes a JSON POST only, refuses unknown fields and assets the tab does not own, and is a dry run unless the page says otherwise.
- **CHARACTERS-027** The route is mounted by the Characters tab for its categories (see OBJECTS-002 for the Objects tab).
