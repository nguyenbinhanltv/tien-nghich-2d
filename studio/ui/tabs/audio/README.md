# Audio tab

Library, audition, pictures, sprite map, listening checklist and patch/score preview for the project's beds and effects. Everything
lives in this directory under the tab contract in `studio/ui/README.md`; no shared file is edited. **No agent listens to anything
here.** The page measures and draws; whether it sounds right, and signing it off, is a person's act.

```
index.mjs      mount/update/unmount, the three-column page, deep links       model.mjs     pure logic (routes, status, filters, blind-test maths, sprite checks, patch parameters)
library.mjs    filters and the cue list                                       engine.mjs    WebAudio: one bus, level match, mono fold, loop region, no context before a click
listen.mjs     Listen view: version, loop x3, seam, solo/over a bed           ab.mjs        blind A/B
pictures.mjs   waveform + spectrogram from studio/audio                       sprite.mjs    sprite map of a pack with guard gaps
patch.mjs      patch/score viewer + scratch preview                           side.mjs      numbers, pack evidence, checklist, sign-off
server.mjs     /api/tabs/audio/*                                              evidence.mjs  reads the plan, packs, ledgers, masters, engine documents
i18n/en|vi     strings                                                        audio.css     look (CSS variables from the pack)
```

## What it reads (all through the project pack)

The `audio-plan` catalog source gives the manifest (cue ids, families, asset groups, mode events) and three evidence directories:
packs (`*/pack.json`, `evidence.json`), masters and per-batch source ledgers. From them the server builds, per cue:

* **stage**: `planned` (a design only), `master only` (a WAV exists), `packed` (a pack carries it; packs are the evidence, because the
  catalog's own readiness reads only `pack.bgm` and misses packs that list several beds under `bgms`);
* **kind**: a bed if a pack lists it as one or its master sits alone in its folder; otherwise an effect;
* **families and mode events** from the manifest, and the asset group each family is bound to;
* **recorded figures** from the ledger (beds: `verification`; effects: `masters[]`) and the pack (`master.loudness`, per-codec peak,
  head offset, loop frames, seam SNR, decoded sprite markers), and **live figures** from `studio/audio` (`measure`, cached by sha256).

## Listening state and sign-off

Listening is one of `approved`, `needs work`, `stale sign-off` (signed for a different master), `pending`, `not yet made`. It comes from
the Review tab's store (`GET /api/tabs/review/inbox`), keyed by the master's sha256; without a store it falls back to the pack
evidence's `human_listening` word. **This tab has no store and no sign-off route.** The sign-off form posts
`{id, content (sha256), verdict, note}` to the Review tab's `POST /api/tabs/review/audio-signoff`, which requires a same-origin
browser request. The form needs every checklist item ticked and something actually played in this page, and the handler ignores
scripted (`isTrusted === false`) clicks; none of that stops a determined agent driving a browser, which is why the real guarantee
is that no MCP tool reaches that route (`studio/mcp/humanonly.test.mjs`). If the Review tab is not installed the form says so and stays disabled.
`contract.test.mjs` checks that only `side.mjs` mentions the route and the server keeps no sign-off table.

The note stored with a signature lists the checklist (`[x]`/`[ ]`), the blind A/B result and which versions were played.

## Audition

* Versions: Master WAV, Ogg, AAC from the pack. A bed's codec loop comes from the pack's decoded loop frames; the page compares the
  frame count the browser decoded with the pack's and says when they differ (an AAC decode may be trimmed differently by a browser).
  An effect's codec version plays its slice of the pack's effect sprite by the decoded markers.
* **Level-matched** plays a cue at about -23 LUFS by its ungated K-weighted loudness, never above -1 dBFS sample peak; all versions
  of one cue share the gain, so master/Ogg/AAC compare at equal level. Over a bed, levels are left as in the game.
* **Loop x3** plays the loop region three times; **Seam ±4 s** starts 4 s before the loop end. **Switching version while playing**
  keeps the position (the codec's lead-in shifts its loop).
* **Fold to mono** puts a one-channel node before the output.
* **Blind A/B**: the cue under review against a partner (pairs named by the manifest's optional `audition_pairs`, then the closest by
  measured features, then any effect), six trials, level-matched, position randomised, exact guessing p-value.
* Nothing plays, and no `AudioContext` exists, until a button is clicked.

## Preview

`POST /api/tabs/audio/preview {doc}` validates a patch or score with `studio/audio`, applies the project's sample rate, renders into
`<os temp>/studio-audio-scratch-*` (never inside the project's delivered audio directories; at most 20 s for a patch, 150 s for a
score; at most 24 kept) and returns measurements. `preview-file` and `preview-image` read it back. An unchanged document renders the
delivered master byte for byte (tested).

## Tests

```sh
node --test studio/ui/tabs/audio/*.test.mjs
```

`model` (pure logic), `server` (every route against the real data, plus a second project with another rate and different names),
`i18n` (EN/VI parity), `contract` (no project literals, one sign-off mention, playback only from clicks). Browser check: see the PR
screenshots in `screenshots/`.
