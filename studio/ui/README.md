# Pixel Kiln shell and tab contract

The studio UI is plain ES modules and CSS served as-is: no bundler, no framework, no dependencies, loopback only. `studio/index.html` is the shell at `/studio/`. It owns the rail with the nine destinations, the top bar, URL routing, the Cmd/Ctrl+K palette, the English/Vietnamese switch and the project name. Each destination is a **tab module** that the shell mounts into `<main>`.

```
studio/index.html            shell page            ┐
studio/ui/shell.js|css       rail, top bar, tabs   │ shell-owned: tab workers
studio/ui/router.mjs         #/tab/asset?... URLs  │ do not edit these
studio/ui/palette.mjs        Cmd/Ctrl+K            │
studio/ui/destinations.mjs   the nine ids + icons  │
studio/ui/i18n.mjs, i18n/*   shell strings (en, vi)┘
studio/ui/tabs/<id>/         ONE DIRECTORY PER TAB, owned entirely by that tab
studio/ui/tabs/_placeholder/ shown for a destination whose module does not exist yet
studio/ui/tests/             shell tests (router, i18n, the contract test)
```

The nine ids are `overview characters objects vfx audio review jobs sandbox atlas`. The shell also owns one screen that is not a destination: **Projects** (`#/projects`, `studio/ui/hub/`), opened from the project button in the top bar and shown by default when the server runs with no project. Tabs need nothing for it: after a project switch the shell reloads, so every tab mounts again against the new project.

## Adding a tab without editing any shared file

Create `studio/ui/tabs/<id>/` and put these files in it. Nothing else changes: the shell asks the server which tab directories have an `index.mjs` and loads those, the rail already lists all nine destinations, the palette already jumps to them, and the contract test discovers new directories by itself.

| File | Required | Purpose |
|---|---|---|
| `index.mjs` | yes | the module (contract below) |
| `i18n/en.json`, `i18n/vi.json` | yes | the tab's own strings, flat `key → text`; same keys and `{placeholders}` in both (tested) |
| `*.css` | no | loaded with `ctx.loadCss(new URL('./x.css', import.meta.url))` |
| `server.mjs` | no | server routes, reached at `/api/tabs/<id>/…` (see below) |
| `*.test.mjs` | no | tests next to the code; `node --test 'studio/ui/tabs/<id>/*.test.mjs'` |
| anything else | no | helper modules, fixtures; import them with relative paths |

The other shared inputs are data, not code, and a tab does not need to change them: labels, colours and the category → tab mapping come from the project pack (`studio.project.json` → `ui`), and the catalog comes from `GET /api/studio/*`. If a tab needs a shared capability that does not exist (a new `ctx` helper, a new catalog field), ask the shell owner rather than editing the shell.

Strings: `ctx.t('key', {name})` looks in the tab's `i18n/<lang>.json` first, then the shell's, then English, then returns the key. Pack labels (`{en, vi}` objects) go through `ctx.label(obj)`. Never hard-code a user-visible string, a project colour or a project name; read them from `ctx`.

## The module contract (`index.mjs`)

```js
// Required. Pure: no DOM, no fetch. Turns the parsed URL into this tab's own state.
export function parseRoute(route) { return {...}; }

// Required. Build your UI inside ctx.root. May be async. `state` is parseRoute(route).
export async function mount(ctx, state) {}

// Optional. If present, the shell calls it instead of unmount+mount when only the URL
// changes inside the same tab (for example another frame or asset). If absent, the shell remounts.
export async function update(ctx, state) {}

// Optional. Clean up what you created outside ctx.root (timers, document listeners).
export async function unmount(ctx) {}
```

`route` is `{tab, asset, clip, direction, frame, params}`: `asset` is an id or `null`; `clip`, `direction` and `frame` are only set when `asset` is, and `frame` is a non-negative integer; `params` is every other query parameter, untouched, so a tab can keep its own state in the URL (`zoom=4`, `onion=1`). `parseRoute` must be total: any route gives a state, never a throw (the contract test calls it with junk).

`ctx` (created fresh for every mount):

| Member | Meaning |
|---|---|
| `root` | the element you own; the shell empties it when the tab goes away |
| `tab`, `lang`, `project` | your id, the current language, the project info (`name`, `theme`, `tools`, `categoryTabs`, `sources`, …) |
| `t(key, vars)`, `label(obj)` | strings, see above |
| `api(path)` | `GET /api/studio/<path>` as JSON (catalog, see below); aborted on unmount |
| `tabApi(path)` | `/api/tabs/<id>/<path>` as JSON, your own `server.mjs` |
| `fetchJson(url)` | any same-origin JSON request, aborted on unmount |
| `href(route)` | `#/…` link for a route object, for `<a href>` |
| `navigate(route, {replace})` | change the URL; `route` is `{tab, asset, clip, direction, frame, params}`; `replace` skips history |
| `categoryTab(category)` | the destination that owns an asset category (from the pack) |
| `loadCss(url)` | load a stylesheet once |
| `announce(text)` | polite screen-reader message |
| `signal` | `AbortSignal` aborted on unmount |
| `onUnmount(fn)` | register a cleanup |

Rules: touch only `ctx.root` (and `document` listeners you remove in `unmount`/`onUnmount`); keep every control keyboard reachable with a visible focus; draw sprites with `image-rendering: pixelated` and integer zoom; use the CSS variables from `shell.css` (`--ink --surface --line --muted --text --accent --gold --danger`, derived from the pack's palette ids) so another project gets its own look; do not call any write API of another tab. Human-only actions (approve, sign, publish) belong in the UI only and never behind a tab API that an agent could call.

If `mount` throws, the shell shows an error panel with a retry button and keeps the rest of the studio working.

## Keyboard shortcuts and the cheat-sheet (lane 4D)

The shell owns the global keys: `⌘K` / `Ctrl K` opens the command palette, `?` opens the cheat-sheet (Esc closes it and focus goes back to where it was), and `g` then `1`–`9` jumps to a destination (the hint is shown beside each rail item). All of them are ignored while focus is in an `input`, `textarea`, `select` or `contenteditable` element, so a tab never has to guard against typing. The palette also has an Actions group (open the next item awaiting review, recent assets, default zoom, language, copy the open asset's id, open another project). None of them decides or approves anything: "next item" only navigates, and a person decides in the Review tab.

A tab lists its own keys in the cheat-sheet by exporting a plain array from `index.mjs`. The tab still handles the keys itself (use `isTyping` from `../../palette.mjs`, or the same rule: skip input, textarea, select, contenteditable and any modifier key); the list is documentation shown to the person.

```js
// Optional. `keys` are shown one <kbd> each; `label` is a key in the tab's own i18n files (EN and VI).
export const shortcuts = [
  {keys: ['['], label: 'keys.prev'},
  {keys: [']'], label: 'keys.next'}
];
```

The default zoom chosen in the palette is stored in `localStorage` (`studio.zoom`, one of 1, 2, 3, 4, 6, 8) and passed to a tab as `ctx.defaultZoom` (a number, or `null` when never set). A tab may use it as the starting zoom when the URL has no `zoom`; none does yet.

## Review standing: what a tab may say about a frame

A frame's review state is never "approved" by default. The store reports revision 0 of a frame nobody judged in the studio by the project's records (`studio/core/standing.mjs`): **approved** only when `directories.approvals/art_approvals.json` holds the sha256 of exactly these bytes, **baseline, no review record** when the pack's `review.baseline` (a per-directory digest record written by `node studio/baseline.mjs --write`) still covers it, and **awaiting review** (`pending`) otherwise, which is also what a pack with no `review` block gives for everything. A human verdict in the revision store wins over all three; a later revision is always `pending`. A tab shows `snap.status` as the store returns it (`status.baseline` and `status.pending` strings exist in EN and VI) and must not derive an approval of its own.

## URLs and deep links

```
/studio/#/<tab>[/<assetId>][?clip=<clip>&dir=<direction>&frame=<n>&source=<id>&…]
```

Examples: `#/overview`, `#/characters/wl_outer_disciple?clip=idle&dir=south&frame=3`, `#/vfx/hit_spark?clip=burst`. Hash routing needs no server rewrite, and `/preview-app/…` keeps working as an alias. `source` is only needed when the same id exists in two catalog sources. Unknown tabs fall back to Overview. Legacy deep links `/studio/?tab=arena` and `/studio/?tab=inspector` are answered by `studio/previewer.html`, the original two-tab previewer, unchanged.

Every existing tool stays reachable from the rail's "Existing tools" list. The list comes from the pack (`ui.tools`); a tool whose `tab` matches a destination without a module also appears on that destination's placeholder.

## Server side

- `GET /api/studio/project`: project name, brand, languages, theme colours resolved from the palette, tool list, category → tab map, and which tabs have a module.
- `GET /api/studio/assets?category=&readiness=&chunk=&wave=&source=&group=&q=&limit=&offset=`: filtered catalog (facet counts included).
- `GET /api/studio/assets/<id>[?source=]`: one asset with its manifest record, clips, frames and provenance pointers.
- `GET /api/studio/overview`: readiness by source, group, category and wave, and the per-chunk atlas budget.
- `/api/tabs/<id>/…`: served by `studio/ui/tabs/<id>/server.mjs` if it exists (`export async function handle(req, res, url, {root, address, prefix})`). The loopback and same-origin check has already run; write the response yourself. A tab owns its own routes and tests; no shared file lists them.

Readiness is `planned` (designed only), `authored` (frames or masters exist) or `packed` (in an atlas or an audio pack). It is derived from the manifests and the files on disk, never typed by hand.

## Tests

`node --test 'studio/ui/tests/*.test.mjs' studio/server/catalog-api.test.mjs` covers routing, strings, the tab contract, the catalog API and the Overview numbers. `studio/tests/shell-browser.test.mjs` is a Playwright script for the shell in a real browser (needs `playwright-core` and a Chromium path, like the other `*-browser.test.mjs` files; it is not part of the baseline because Playwright is not installed here).

## Design tokens, fonts and the shell skin (lane 2A)

`tokens.css` defines every `--ui-*` variable of the contract below, plus a few the shell alone uses. Load order in `index.html`: `tokens.css`, `components.css`, `shell.css`. A token reads a pack colour (`--theme-<role>`, written by `shell.js` from `ui.theme`) through a fallback chain, so a pack that leaves a role out still looks complete. The studio names no project colour: the hex values in `tokens.css` are neutral greys for a pack with no theme at all.

The pack's `ui.theme` has 18 roles, each a palette id (the schema and the generated pack reference in `studio/README.md` describe them):

| Role | Token it feeds | If the pack leaves it out |
|---|---|---|
| `ink` | page background `--ui-bg`, text on a fill `--ui-on-accent` | neutral dark |
| `surface` | raised control `--ui-surface-raised` | neutral |
| `panel` | the slip (card, stat, panel) `--ui-surface` | `surface` 55% over `ink` |
| `line`, `lineStrong` | divider; control border (3:1) | neutral; `muted` |
| `text`, `muted` | body and secondary text | neutral |
| `accent`, `accentSoft` | primary action, selected | neutral teal |
| `gold`, `goldSoft` | attention, focus ring, titles | neutral gold |
| `danger` | rejected, error (4.5:1 as text) | neutral red |
| `seal`, `sealInk` | the seal: brand mark, badge, stamp | `danger`; `text` |
| `ok`, `warn`, `ask`, `link` | done; needs attention; an agent's question; links and running | `accent`; `gold`; `text`; `accent` |

Shell-only tokens: `--ui-seal`, `--ui-seal-ink`, `--ui-ask`, `--ui-link`, `--ui-rail`, `--ui-bg-glow`, `--ui-sp-6`, `--ui-sp-7`, `--ui-fs-2xl`, `--ui-lh-body`, `--ui-lh-tight`, `--ui-lift`, `--ui-dur-1`, `--ui-dur-2`, `--ui-dur-3`, `--ui-dur-seal`, `--ui-rail-w`.

Type: six sizes, `xs` 12, `sm` 14, `md` 16, `lg` 19, `xl` 24, `2xl` 34 px. Headings use the display serif (`--ui-font-display`), ids and numbers the pixel face (`--ui-font-mono`), body the system sans. Both fonts live in `fonts/` (see `fonts/README.md` for source, version, hashes and licence); they are subsets with full Vietnamese, loaded with `font-display: swap`, and the system fonts are the fallback.

The brand seal is drawn from `ui.brand.seal`, a 12x12 grid of `.` and `#` in the pack, as SVG, so it does not depend on a CJK font. Without it the shell shows the letters of `ui.brand.mark`.

Below 900 px the rail is a drawer: the top bar has a menu button (`aria-expanded`), Escape or the scrim closes it, choosing a destination closes it, and the "Existing tools" list scrolls inside it. The bar stays one row and does not repeat the page title (the tab's own `h1` is the title).

`prefers-reduced-motion: reduce` sets every duration token to 0 and stops all animations and transitions.

## Shared components and the `--ui-*` token contract

`studio/ui/components.css` is the shared component library: `.btn` (`.primary`, `.danger`, `.quiet`), `.seg`, `.chip`, `.field`, `.slip`, `.stat`, `.kbd`, `.empty`, `.skeleton`, `.toast`. Each has hover, active, pressed, disabled and focus-visible states, uses pixel-style `steps()` motion, and turns the motion off under `prefers-reduced-motion`. It is a plain file: link it with `<link rel="stylesheet" href="/studio/ui/components.css">` (or `ctx.loadCss`).

**Contract.** Every colour, space, type size and border in it is a `--ui-*` variable, always with a fallback: `var(--ui-line-strong, var(--theme-muted, #6b6b6b))` means the `--ui-*` token, else the pack colour `shell.js` writes from `ui.theme` as `--theme-*`, else a neutral grey. So the library looks complete before any token file exists. Lane 2A will add `tokens.css` that defines these variables; changing a fallback here is not how to restyle. The library names no project and holds no project colour. `components.test.mjs` checks that only `--ui-*`/`--theme-*` are used, that every `var()` has a fallback, and that this table and the CSS list the same tokens.

| Token | Meaning | Fallback |
|---|---|---|
| `--ui-bg` | page / inset background | `--theme-ink`, `#101014` |
| `--ui-surface` | card, slip, stat background | `--theme-surface`, `#26262c` |
| `--ui-surface-raised` | raised control (button, key, toast) | `--theme-surface`, `#30303a` |
| `--ui-line` | quiet border, divider | `--theme-line`, `#46464e` |
| `--ui-line-strong` | control border | `--theme-lineStrong`, `--theme-muted`, `#6b6b6b` |
| `--ui-text` | body text | `--theme-text`, `#e4e4e8` |
| `--ui-text-muted` | secondary text, labels | `--theme-muted`, `#9a9aa2` |
| `--ui-accent` | primary action, selected segment | `--theme-accent`, `#4aa3a3` |
| `--ui-accent-soft` | primary border, pressed primary | `--theme-accentSoft`, `#2f6b6b` |
| `--ui-on-accent` | text on accent or danger fill | `--theme-ink`, `#101014` |
| `--ui-gold` | hover edge, highlights | `--theme-gold`, `#c8a040` |
| `--ui-gold-soft` | light highlight | `--theme-goldSoft`, `#ecd890` |
| `--ui-danger` | destructive, error | `--theme-danger`, `#d05050` |
| `--ui-ok` | success | `--theme-accent`, `#4aa3a3` |
| `--ui-warn` | warning | `--theme-gold`, `#c8a040` |
| `--ui-focus` | focus ring | `--theme-gold`, `#c8a040` |
| `--ui-stud` | the two studs on a slip's top edge | `--theme-gold`, `#c8a040` |
| `--ui-hover` | hover tint laid over a fill | `rgba(255, 255, 255, .08)` |
| `--ui-press` | pressed / active tint | `rgba(0, 0, 0, .25)` |
| `--ui-shadow` | hard drop and inset shadow | `rgba(0, 0, 0, .45)` |
| `--ui-sp-1` … `--ui-sp-5` | spacing scale | `.25rem`, `.5rem`, `.75rem`, `1rem`, `1.5rem` |
| `--ui-fs-xs`, `-sm`, `-md`, `-lg`, `-xl` | type sizes | `.75rem`, `.85rem`, `.95rem`, `1.2rem`, `1.8rem` |
| `--ui-font-body` | body font | `inherit` |
| `--ui-font-display` | headings, big numbers | body font |
| `--ui-font-mono` | chips, keys | `ui-monospace, Menlo, Consolas, monospace` |
| `--ui-bw` | border width | `2px` |
| `--ui-notch` | slip corner step (two steps of this, so a 3 px step cuts 6 px) | `3px` |
| `--ui-control-h` | height of button, field, segment | `2.25rem` |
| `--ui-step` | duration of one pixel step transition | `100ms` |
| `--ui-slip-n`, `--ui-slip-cut` | internal to `.slip`; do not set | derived from `--ui-notch` |

**Styleguide.** `studio/ui/styleguide.html` shows every component and state in English and Vietnamese (the EN/VI switch, or `?lang=vi`). The studio server serves it as a static file: start `node studio/serve.mjs` and open `/studio/ui/styleguide.html`. It also opens as a bare file or through Orchestrator's static preview, with the neutral fallbacks; served by the studio it adopts the project's `ui.theme`. The "State" rows pin each state with the mirror classes `.is-hover`, `.is-active`, `.is-pressed`, `.is-focus`; real use needs only the pseudo-classes and `aria-pressed`.

## Pixel viewer (`pixelview.mjs`, lane 4B)

A small module any tab can use to show pixel art. It holds no project data. Load `pixelview.css` with `ctx.loadCss(new URL('../../pixelview.css', import.meta.url))` (path from a tab's `index.mjs`).

- **Pure helpers** (Node-testable): `ZOOMS` (1, 2, 3, 4, 6, 8, 12, 16; never fractional), `snapZoom`, `fitZoom` (largest level that still fits), `stepZoom`, `isZoom`, `gridShown(zoom, on)` (grid from `GRID_MIN_ZOOM` = 8), `pixelAt(clientX, clientY, rect, size)` (native pixel under the pointer, or `null`), `wipeFraction`, `wipeColumn`, `shortcutFor(keyEvent)`.
- **Frame:** `pixelFrame({canvas, size, bg, zoom, grid})` wraps a canvas with a CSS grid layer and one of three checker backgrounds (`dark`, `light`, `palette`; the last follows the pack's `--ui-*` tokens). `setView(root, {bg, zoom, grid})` changes them in place, with no canvas redraw and no loss of focus, so grid and coordinates cost nothing during playback. The canvas stays `image-rendering: pixelated`.
- **Pointer:** `trackPointer(canvas, size, outputEl)` writes `x, y` when the pixel under the pointer changes. `dragWipe(canvas, onWipe)` reports a 0..1 position (at most once per animation frame) for a wipe between two images.
- **Controls:** `pixelToolbar({labels, zoom, auto, grid, bg, wipe, onZoom, onGrid, onBg, onWipe})` returns `{el, coords}`: zoom out/select/in, grid switch, background choice, optional wipe slider (pass `wipe` as a number only when comparing) and the coordinate readout. Labels come from the caller's i18n. Controls carry `data-fk`; a tab that redraws should refocus the element with the same `data-fk` afterwards (the Characters stage does).
- **Keys:** `installShortcuts((action, event) => bool)` listens on the document and returns its remover. Actions: `play` (Space), `prev`/`next` (← →), `zoomIn`/`zoomOut` (+ −), `grid` (G). Keys are ignored while typing in an input, textarea, select or editable field, with Ctrl/Meta/Alt held, and Space is left to a focused button. The shell's `g` then digit tab chord still works because its second key is a digit.
- First user: Characters stage (`tabs/characters/stage.mjs`), which also uses the wipe (Compare → Wipe), onion skin and diff (changed pixels only).

## Viewport screenshots (Pixel Kiln)

`studio/ui/tests/viewport-harness.html` embeds the running studio in an iframe at 1600, 1280, 900 or 420 px for one tab and one language, with buttons to switch each. Open `http://127.0.0.1:4173/studio/ui/tests/viewport-harness.html?tab=review&w=900&lang=vi` after `node studio/serve.mjs --port 4173`. Query: `tab`, `w`, `h` (iframe height), `lang`, `fit` (`1` shrinks to the panel, `0` is real size), `capture=1` (hides the controls). Once the tab has settled the page title reads `READY <tab> <lang> <w>x<h> overflowX=<px> offenders=<n>`; the overflow figure only sees content that escapes the page, not content a panel clips or scrolls inside itself, so look at the image too.

`studio/ui/tests/capture-viewports.sh [out-dir]` takes all 9 tabs × EN/VI × 4 widths = 72 PNGs through the Orchestrator Browser panel (`ao browser`; Playwright is not used and not needed). Run it from a worker session with the Browser panel visible. Images and a `report.tsv` go to `out-dir` (default: a new temp directory), never into the repo. `TABS`, `LANGS`, `WIDTHS` and `HEIGHT` env vars narrow the run.

## Interface modes and density

`studio/ui/theme.mjs` holds the choice; `shell.js` writes `data-theme` (`abode` | `ink` | `paper`) and `data-density` (`comfortable` | `compact`) on `<html>`, remembers them in `localStorage` (`studio.theme`, `studio.density`) and, until a mode is chosen, follows `prefers-color-scheme`. Change them from the top-bar menu or the command palette's actions.
A mode's colours are pack roles: `ui.theme` for abode, `ui.themeModes.<mode>.colors` for ink and paper (palette ids; the server resolves them to hex). A role or a whole mode the pack leaves out falls to that mode's neutral `--fb-*` default in `tokens.css`. Tabs must not hard-code a colour: use `--ui-*` (the transparency checkerboard is `--ui-checker-a/b`).
Targets: text 4.5:1, control border 3:1, body text 7:1 in ink. `studio/ui/tests/theme-modes.test.mjs` computes them. The viewport harness takes `theme=` and `density=`.
