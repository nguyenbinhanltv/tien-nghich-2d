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
