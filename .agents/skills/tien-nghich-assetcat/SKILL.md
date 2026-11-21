---
name: tien-nghich-assetcat
description: Search an indexed local project library with AssetCat for Tiên Nghịch audio or asset references and inspect recorded licenses and AI provenance.
---

# Look up project assets with AssetCat

Use the installed executable by name or full path. Check `--version` and `config library`; account for process overrides such as `ASSETCAT_LIBRARY`, `ASSETCAT_PROFILE` and `ASSETCAT_CACHE`. Confirm the configured library is in scope before querying it. For an existing project index, use `stats --json` to check the library, profile and indexed counts. If a disposable setup check is requested, use the isolated fixture recipe in the [setup document](../../../docs/SKILLS_INSTALLED.md#assetcat-setup-verification).

1. Search pack names with `assetcat search --packs <query> --json`. For audio filenames use `assetcat search <query> --media audio --json`. These are local word searches.
2. Pass a returned pack ID to `assetcat show <pack-id> --json`. Pass the returned library-relative file path as one argument to inspect the asset, including its type, format and duration where available.
3. Report the pack's license, supporting license file, AI status and reason. Preserve unknown values. Where the project has its own provenance ledger, cite that evidence separately. For shared reports, use authorized pack IDs and relative paths and omit absolute paths and private inventory.
