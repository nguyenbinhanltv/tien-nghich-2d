# Behaviour specs

One short file per tab (`overview.md`, `characters.md`, `objects.md`, `vfx.md`, `audio.md`, `review.md`, `jobs.md`, `sandbox.md`, `atlas.md`), one for the shell (`shell.md`), one for the Projects screen (`projects.md`) and one for the MCP (`mcp.md`). Each file lists the behaviours that must stay true, one per line, each with a **stable id**:

```
- **REVIEW-001** (human-only) A listening sign-off is recorded only by a browser page, for the exact master that was heard.
```

The id is `<FILE IN CAPITALS>-<three digits>`. It never changes and is never reused: if a behaviour is dropped, delete the line and leave the number unused. Wording may change; the id may not.

## Tests name the id

A test that checks a behaviour puts the id in its name, anywhere in it:

```js
test('REVIEW-001: listening sign-off: only a browser page records it, only for the exact master', ...)
```

One test may name several ids; several tests may name the same id. `specs.test.mjs` fails when

- a spec id has no test that names it,
- a test names an id under a known prefix (`REVIEW-099`) that no spec defines,
- a test name starts with an id-shaped word (`FOO-001:`) whose prefix is not a spec file,
- an id is defined twice, or sits in the wrong file, or a line looks like an id but is malformed.

Only the name of a `test(...)`, `it(...)` or `describe(...)` counts; an id in a comment or a string does not. Adding an id to an existing test means adding it to the name and nothing else.

## What goes in a spec

Behaviours a person would be upset to lose: who may approve, what may touch shipped files, what may start playing sound, what may listen on the network, what a tool refuses. Not every function. The first four groups (marked in the lines) are the ones that matter most:

| Mark | Meaning |
|---|---|
| `(human-only)` | only a person can do it; no tool or API an agent can reach may |
| `(staging)` | work lands beside shipped files, never in them |
| `(silent)` | no sound before a click |
| `(loopback)` | reachable from this machine only, from the same origin |
