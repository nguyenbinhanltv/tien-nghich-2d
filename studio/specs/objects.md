# Objects tab behaviours

- **OBJECTS-001** The tab's API is read-only apart from the spritesheet import, and refuses bad input with a reason.
- **OBJECTS-002** The spritesheet importer is mounted for objects only: an asset that belongs to another tab is refused. It follows the same rules as the Characters importer (CHARACTERS-020 to CHARACTERS-026).
- **OBJECTS-010** The timeline panel (Characters and Objects tabs) shows an asset's tags and linked cels, checks a transform or an import before applying it (dryRun is the default), exports a .pxo or .ase and takes a hand-edited file back; every string exists in English and Vietnamese. It is a page action: no MCP tool imports a file.
