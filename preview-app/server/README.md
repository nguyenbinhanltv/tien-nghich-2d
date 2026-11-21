# Local Inspector frame API

Run `node preview-app/serve.mjs` with Node 24 (verified with 24.12). Open the printed loopback address. The editor uses Node's built-in SQLite module. The original preview index, assets and atlas routes remain available. The editor requires a loopback listener, a matching local Host and, for browser requests that supply Origin, the same HTTP origin. Send JSON for all POSTs. Treat review comments as plain text when rendering.

## Discover and load

All routes below start with `/api/editor/`. GET parameters are URL query fields. POST parameters are JSON object fields. Use the exact catalog key, for example `ui/ui_minimap/room_none_0` or `vfx/hit_spark_0`.

| Request | Result |
|---|---|
| GET `frames` | `{frames:[{key,assetId,category,width,height,sourceUrl,processedUrl,editableFields}]}`. Membership grants frame editing capability. All other Inspector assets are read-only. |
| GET `frame?key=…` | Current head snapshot. Supply `revision=N` to view history. |
| POST `save` | Send `key`, `baseRevision` and at least one of `pngBase64` or `metadata`. Returns a snapshot. |
| POST `restore` | Send `key`, `baseRevision` and `targetRevision`. Copies the target pixels and metadata into a new pending head. |
| POST `review` | Send `key`, exact `revision`, and `status`, `text` or both. Returns the selected revision snapshot. |
| GET `export?key=…&revision=N` | Deterministic single-frame export containing `key`, `revision`, `pngBase64`, `metadata` and `atlas`. |
| GET `image?key=…&revision=N` | Native PNG bytes for that revision. The atlas references this URL in `meta.image`. |

Each snapshot contains the catalog fields plus `head`, `revision`, `pngBase64`, `metadata`, `status`, `comments` and `history`. Head is the latest stored revision. Revision is the selected one. Baseline is 0 with parent null. History is newest first, with `{revision,parent,status}` per entry. Comments are oldest first, with `{text,status}` giving the status when recorded. The VFX source URL points to its authored JSON spec. UI source URLs point to native source PNGs. The processed URL always serves the committed baseline PNG. Use snapshot pixels or the versioned image URL to preview edits.

## Edit and review

PNG input is canonical base64 (no data URI) of a native-size, 8-bit RGBA, non-interlaced still PNG, at most 128 KiB. Canvas PNG output is supported. Visible pixels must use the project palette and alpha must be 0 or 255. The server normalizes transparent RGB, checks chunk CRCs and scanline lengths, and strips ancillary metadata. JSON request bodies are limited to 192 KiB.

Metadata updates are patches. UI and VFX accept `pivot:[x,y]` as integer pixel coordinates inside the frame. VFX also accepts integer `durationMs` from 1 through 60000. Unknown fields are rejected. Unchanged content and metadata at the current base reuse the head. A stale base returns HTTP 409 with the current head, including on retry after a lost response. Reload and compare before resubmitting.

Set status to `pending`, `approved` or `changes_requested`. Text is optional when setting a status, and can contain up to 2000 UTF-16 code units. A comment without a status preserves the existing status. Reviews apply only to the selected revision. A content edit after approval starts pending with an empty comment list. Restore also starts pending, even if the restored pixels match the current head.

## Persistence, recovery and export

Canonical frames default to **Approved** at revision 0, including in older libraries that have no explicit baseline decision. Opening a frame or its history only reads it. A no-op save preserves the selected head's decision. An explicit decision on any revision takes precedence over the default and keeps its comments. Changing content or restoring a version creates a **Pending** head.

The first mutation pins the original revision and creates a local SQLite database in the gitignored `.inspector-revisions/` directory. Opening a pristine catalog or frame creates no library. Each save, restore or review is a single transaction. Two preview processes sharing the library serialize their writes and check the base inside that transaction. Restart using the same library to recover the last committed state. To use an isolated library, pass `--revision-dir <absolute-directory>` outside the repository, under an existing user-private parent. On Windows the directory inherits its parent's ACL. Use a dedicated directory accessible only to the intended account. SQLite files are never published by the server.

Export reads the same revision snapshot as the Inspector and never rebuilds committed atlases. Decode `pngBase64` and save alongside the hash-format atlas for offline use, setting `atlas.meta.image` to the saved PNG filename. Frame rectangles use native dimensions, atlas pivots are normalized, and VFX duration is in milliseconds. Reviews do not change export bytes.

Errors have shape `{error:{code,message}}`. A conflict also includes top-level `head`. Status codes include 400 for malformed JSON, 403 for origin or listener rejection, 404 for unknown frames or revisions, 405 for method mismatch, 409 for a stale base, 413 for request size, 415 for media type, 422 for invalid fields, metadata or PNG, and 500 for a library failure.

Run `node --test preview-app/server/editor.test.mjs` for the API suite and `node preview-app/smoke-test.mjs` for existing Inspector behavior. Set TMP/TEMP (TMPDIR on Unix) to an account-private scratch directory for an isolated run.

## Publish an approved revision into the project atlases

Use the local CLI from the repository root with Node 24, Python and the project's Pillow dependency. Choose the catalog key and exact **Approved** head shown in the Inspector. Start with a preview.

```sh
python tools/scripts/promote_frame.py --key ui/ui_minimap/room_none_0 --revision 3
```

The preview validates the current web/mobile atlases, stages and checks the repack, and lists the source and atlas files that would change. Add `--apply` to repeat the checks and materialize the changes. Pass `--revision-dir <absolute-private-library>` on both commands if the Inspector used a custom library. A newer head, revoked approval, conflicting shared history or changed source fingerprint stops publication. Older libraries without fingerprints require a fresh explicit approval while their revision 0 still matches the project. Use a fresh library to reconcile changed source inputs. The CLI holds the library writer lock during its checks; finish edits before running it.

Each selected frame has one entry in `assets/approved-frames.json` containing its key, local revision number, original source fingerprint, native PNG bytes and allowed metadata. This file is a shared build input. The original UI art and procedural VFX spec continue to generate the underlying frames. The packer applies the approved entry after generation and rejects upstream drift. Published pivots appear in atlas records as normalized coordinates; VFX duration is in milliseconds. Restart the preview server to load a newly published input. A fresh library opens its effective pixels and metadata as Approved revision 0. Existing libraries retain their own revision numbers, comments and decisions.

Inspect the listed files with Git and run `python tools/scripts/pack_atlases.py --check` and `python tools/scripts/check_manifest.py`. A clean `python tools/scripts/pack_atlases.py` rebuild uses the shared entries without the local database. Keep revision databases and the recovery journal private. The workflow writes project files only on explicit apply or recovery. If the process is interrupted during apply, run `python tools/scripts/promote_frame.py --recover` before retrying. Recovery restores the recorded before-images and stops if a target contains an unrelated subsequent edit.
