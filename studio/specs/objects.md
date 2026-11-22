# Objects tab behaviours

- **OBJECTS-001** The tab's API is read-only apart from the spritesheet import, and refuses bad input with a reason.
- **OBJECTS-002** The spritesheet importer is mounted for objects only: an asset that belongs to another tab is refused. It follows the same rules as the Characters importer (CHARACTERS-020 to CHARACTERS-026).
- **OBJECTS-011** A tileset tile may carry an animation (tiles of its sheet with milliseconds) and collision shapes (rectangle, ellipse, point, polygon in tile pixels, with custom properties), stored in the asset's metadata (studio_metadata_set `tiles`), validated against the tile size and the sheet, and listed read-only in the Objects tab.
