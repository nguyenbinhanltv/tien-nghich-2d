# Overview tab behaviours

- **OVERVIEW-001** Importing a spreadsheet of planned assets never overwrites an existing id (in a manifest, in the plan store, or earlier in the same file) and a dry run writes nothing.
- **OVERVIEW-002** The importer reads the file first and answers with its headers, a suggested column mapping, the project's chunks, profiles and categories, and a sample; unmapped columns travel with each entry as context.
- **OVERVIEW-003** The import route takes a JSON POST only and needs a column for the id and the brief.
- **OVERVIEW-004** (loopback) The catalog API behind the Overview numbers is read-only, loopback-only and answers errors as JSON.
