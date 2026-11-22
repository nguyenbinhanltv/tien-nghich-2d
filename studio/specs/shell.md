# Shell behaviours

The rail, the top bar, the command palette and the theme roles that the shell and the shared components read from the project pack.

- **SHELL-001** The top bar is one line at every width: the clip, direction and frame of a route are one label (not one chip each), the project button stays visible and opens the Projects screen.
- **SHELL-002** `lineStrong` is a theme role (a palette id) for control borders, 3:1 against the surface (WCAG 1.4.11); a pack that does not say it falls back to its `muted` colour and then a neutral grey that also passes.
- **SHELL-003** The command palette closes whenever the route changes; after that, or after a change of tab, focus lands on the content, and closing it without a route change returns focus to where it came from (the search button if that is gone). The first load takes no focus.
- **SHELL-004** Shortcuts (`?`, `g` then a number) are ignored while focus is in an input, textarea, select or contenteditable element.
- **SHELL-005** The palette remembers the last 10 assets opened, per project, newest first and without duplicates; stored entries that are malformed are dropped.
- **SHELL-006** The default-zoom action cycles 1, 2, 3, 4, 6, 8; "open the next item awaiting review" only picks an item a human has yet to judge, after the open one, and only navigates.
- **SHELL-007** The palette has an Actions group (next pending, default zoom, language, copy the open asset's id, open another project, show shortcuts) and offers no decision: nothing in it approves, signs or posts.
- **SHELL-008** `?` opens a modal cheat-sheet listing the global keys and the open tab's declared `shortcuts`; Esc closes it, Tab stays inside it, and focus returns to where it was (the content if that is gone).
- **SHELL-009** The shell wires `?`, shows a `g n` hint beside each rail item, closes the cheat-sheet on a route change and keeps the palette's focus hand-off.
