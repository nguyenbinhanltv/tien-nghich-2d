# Interface modes and density

Three modes (abode, ink, paper) and two densities (comfortable, compact). The choice is a preference of the browser: it changes how the studio looks and nothing it does, and it never touches approval.

- **THEME-001** The pack declares `ui.themeModes` for ink and paper (abode keeps `ui.theme`); every colour is a palette id, each mode has a name in both languages, and every text pair is at least 4.5:1, every control border and focus ring at least 3:1, and the carved seal 4.5:1.
- **THEME-002** Ink is a dark mode whose body text is at least 7:1 on every surface; paper is a light mode with dark text and a red seal that shows on the paper.
- **THEME-003** A pack that declares no mode (the 12-colour sample) gets the neutral defaults of each mode (`--fb-*` in `tokens.css`), and those pass the same pairs.
- **THEME-004** `tokens.css` carries the neutral defaults, the ink and paper blocks with their `color-scheme`, and the compact density; the short names of `shell.css` follow the `--ui-*` tokens, so they follow the mode.
- **THEME-005** The stored choice wins; with none, a light system preference opens paper and anything else the abode; a stored value that is no mode counts as no choice.
- **THEME-006** Applying a mode removes every `--theme-*` written for the last one, so a mode that names fewer roles never keeps the previous colours.
- **THEME-007** The choice is kept in `localStorage`, and a storage that refuses neither throws nor blocks the change.
- **THEME-008** The top bar menu is a toggle with `aria-expanded`, the command palette has a mode action and a density action, the system preference is followed until a choice is stored, and none of this posts anything.
- **THEME-009** The schema and the pack agree on `ui.themeModes`.
- **THEME-010** A change of the system colour scheme restyles the page without remounting the open tab (it happens by itself and must not discard what is being typed); an explicit choice of mode still redraws the tab.
