# Shell behaviours

The rail, the top bar, the command palette and the theme roles that the shell and the shared components read from the project pack.

- **SHELL-001** The top bar is one line at every width: the clip, direction and frame of a route are one label (not one chip each), the project button stays visible and opens the Projects screen.
- **SHELL-002** `lineStrong` is a theme role (a palette id) for control borders, 3:1 against the surface (WCAG 1.4.11); a pack that does not say it falls back to its `muted` colour and then a neutral grey that also passes.
- **SHELL-003** The command palette closes whenever the route changes; after that, or after a change of tab, focus lands on the content, and closing it without a route change returns focus to where it came from (the search button if that is gone). The first load takes no focus.
