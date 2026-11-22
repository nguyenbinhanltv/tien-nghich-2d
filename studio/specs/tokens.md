# Design tokens and the shell skin

`studio/ui/tokens.css`, the 18 theme roles of the pack, the brand seal, the two local fonts and the narrow-width drawer.

- **TOKENS-001** `tokens.css` defines every `--ui-*` variable that `components.css`, `shell.css` and the styleguide read, and the type scale has six sizes.
- **TOKENS-002** Colour tokens read pack roles (`--theme-*`) through a fallback chain, and the stylesheets load in the order tokens, components, shell.
- **TOKENS-003** `prefers-reduced-motion: reduce` sets every duration token to zero and stops all animations and transitions; only `steps()` timing is used.
- **TOKENS-004** The pack has 18 theme roles, each a palette id; every text pair is at least 4.5:1 and every control border and focus ring at least 3:1 on the surfaces they sit on.
- **TOKENS-005** A small pack that names none of the new roles still gets text and borders that pass, through the fallbacks.
- **TOKENS-006** The brand seal is a 12x12 grid of `.` and `#` in the pack, and the schema enforces that.
- **TOKENS-007** Both fonts ship as woff2 with their OFL text and a record of source and hash, loaded with `font-display: swap` and a system fallback.
- **TOKENS-008** Below 900 px the rail is a drawer with an accessible toggle, the top bar stays one row and does not repeat the page title.
- **TOKENS-009** `components.css` is wrapped in `@scope (.ui-kit)`: loading it globally changes no tab until a tab puts `ui-kit` on its root; the styleguide does.
