# Projects behaviours

Pixel Kiln is the tool; a project is a folder with a `studio.project.json`. The user-level list of projects, the Projects screen, opening and switching a project in a running server, and the settings of the open project.

- **PROJECTS-001** The list of recent projects lives in the user's config directory (`PIXEL_KILN_HOME` overrides it; macOS `~/Library/Application Support/Pixel Kiln`, else `$XDG_CONFIG_HOME/pixel-kiln`), never in a repo or a project.
- **PROJECTS-002** The list keeps a project once per real path, most recently opened first; removing one drops the entry only and deletes no file; a damaged list file starts empty instead of failing.
- **PROJECTS-003** A typed path is normalised and checked before the disk is read: it must be absolute, without `..` or control characters, and of bounded length (the command line may use a relative one).
- **PROJECTS-004** With no project open the server serves only the studio's own files and `/api/projects`; every project API answers 409 `no_project` and no project file is ever served.
- **PROJECTS-005** Opening a wrong path says why (missing folder, a file, no `studio.project.json`, a pack that fails the schema with its issues, a relative or `..` path) and remembers nothing.
- **PROJECTS-006** The sample project runs through the Projects screen: added by path, shown as a card with its colours and asset count, opened, and then the catalog API answers for it.
- **PROJECTS-007** Switching the open project in a running server reloads the workspace so every tab reads the new project; a switch that fails (folder moved or pack broken) leaves the current project open, and only a project in the list can be opened.
- **PROJECTS-008** A new project is made from a template (`blank` is `init`, `moss-lantern` is a copy with agent configs written for the new place) into a new or empty folder; nothing is overwritten and a refused request creates nothing.
- **PROJECTS-009** Removing a project from the list never deletes its folder.
- **PROJECTS-010** Settings (name, subtitle, mark, theme, size classes) are read with the hash of the pack file, changed through the pack schema check, kept as a revision record first, and refused when stale or invalid, writing nothing.
- **PROJECTS-011** The licence profile and the quota are the owner's decisions: a change is refused unless the owner's decision is stated, and the revision record says so.
- **PROJECTS-012** The projects API is loopback and same origin only, takes JSON only, and has no way to browse or list folders.
- **PROJECTS-013** The `projects list|add|remove` commands keep the same list; `serve` with no project starts on the Projects screen, and `serve --project` records that project as opened.
- **PROJECTS-014** The project switcher in the top bar opens the Projects screen, the screen is the default when no project is open, and every string of it exists in English and Vietnamese.
