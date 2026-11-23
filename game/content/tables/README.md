# Sample content tables (vertical slice: Huyết Hải)

`mobs.csv`, `bosses.csv` and `rooms.csv` are **format samples** for the content pipeline (G0-B). Their numbers
(hp, speed, tell_ms, room mix) are placeholders chosen to exercise the schema and the cross-reference checks;
they are **not balance data**. Asset ids are real (checked against `assets/manifest.json`); the display name of
every mob and boss comes from `content/locale/*.json` under the same id.

Columns are typed by `game/schemas/table-*.schema.json`. `rooms.mobs` is `mob_id:count;mob_id:count`.
`rooms.next` is empty on the last room. `content-build` rejects an unknown id, a wrong type, a dangling
`next` and a `tell_ms` under 250.
