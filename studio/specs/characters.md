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
- **CHARACTERS-028** A new character is judged next to the approved references (the pack's style-locked entities named in `lineup`) on one ground line: studio_template_get lineup=true draws the references into every template cell as a ghost that keys out as background and returns the lineup picture; the figure is measured on its standing pose against them (height, head-to-body share, limb width, outline weight, each as a ratio or difference from the reference).
- **CHARACTERS-029** A build outside the pack's lineup tolerance is blocked with its numbers: studio_process refuses to submit it, studio_qa_run fails with pass false (so an independent check recorded on it does not pass and studio_review_request refuses it), unless the request is an escalation; inside the tolerance but outside the typical band it is only a warning, and a metric that could not be measured is not proven, never a pass.
- **CHARACTERS-030** The lineup tolerance is calibrated on the shipped roster and the approved Longtime characters: none of them is blocked, the numbers are in the pack's `lineup.<group>.measured`, and a regression test measures the whole roster against the pack.
- **CHARACTERS-031** studio_sheet_import reports the lineup as advice on the cleaned sheet (estimates at native size) and studio_review_request carries a lineup picture (the references and the asset's standing frame on one ground line), its hash and the verdict for the human.
