# Sample content tables (vertical slice: Huyết Hải)

`mobs.csv`, `bosses.csv` and `rooms.csv` are **format samples** for the content pipeline (G0-B). Their numbers
(hp, speed, tell_ms, room mix) are placeholders chosen to exercise the schema and the cross-reference checks;
they are **not balance data**. Asset ids are real (checked against `assets/manifest.json`); the display name of
every mob and boss comes from `content/locale/*.json` under the same id.

Columns are typed by `game/schemas/table-*.schema.json`. `rooms.mobs` is `mob_id:count;mob_id:count`.
`rooms.next` is empty on the last room. `content-build` rejects an unknown id, a wrong type, a dangling
`next` and a `tell_ms` under 250.

`content-build` and `contract:check` also run `semanticCheck` (game/tools/lib/tables.ts): ids unique across tables; boss phases strictly descending in `hp_above`
and the last at 0; `dodge_window_ms` not longer than the tell; one hit id per attack; combat rooms have mobs, boss rooms a boss, nothing else has either;
mobs fight only in their own biome; the room chain starts at the single abode room, loops nowhere, reaches every room, has the boss room right before the
reward room and ends on it. An encounter `hit.id` with no hitbox of that name on the boss is a warning (the boxes are drafts); `contract:check --strict` makes it an error.
