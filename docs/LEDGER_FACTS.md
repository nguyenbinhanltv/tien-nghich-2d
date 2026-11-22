# Ledger facts recorded 2026-11-22

Facts the licence ledger (Atlas tab, `studio/core/ledger.mjs`) needs and the repository did not state. Recorded by Claude Code worker `tien-nghich-2d-30` on 2026-11-22, after the owner told the orchestrator to follow its proposal: **record facts, flag what only the owner can know**. Nothing here is a legal conclusion.

## 1. The five assets that had no provenance

`ui_card_frame`, `ui_form_portraits`, `ui_hud_bars`, `ui_minimap`, `ui_panel_cursor` (26 source frames, core manifest, `assigned_agent: codex_antigravity`). They have no `provenance.json` of their own, so the ledger showed "not recorded".

Reconstructed from git history and the repository:

- They were made in commit `6c9ae9e` (PR #22, 2026-11-21, sub-commit "draw five native UI families for the asset library"), by the code in `tools/generators/gen_phase2_ui.py`. `tools/generators/phase2_ui_provenance.md`, added in the same commit, says Codex authored the drawings, that rendering is deterministic, and that there is no random seed or external image input.
- Verified today: running the generator into a scratch directory with the project's Python reproduces all 26 tracked source PNGs byte for byte.
- Each asset now has `assets/raw/environment_items/ui/<id>/provenance.json`, flagged `"reconstructed": true`, with the sources it was built from, the generator hash, the palette hash and the sha256 of each frame.
- Still not established: which agent session ran the generator (the note says "Codex", the manifest says `codex_antigravity`; no session is recorded), and whether anything outside the generator influenced the drawings (none is recorded).

After this, the ledger's "not recorded" count is 45, and all 45 are planned designs with no files yet, not real assets.

## 2. FFmpeg (the pinned Mac build)

Facts from `tools/scripts/build_ffmpeg_611_mac.sh`, `docs/AUDIO_TOOLCHAIN_MAC.md` and the `toolchain` block of `assets/audio/packs/wave2_batch2_v1/pack.json`:

- FFmpeg 6.1.1 (`ffmpeg-6.1.1.tar.xz`, sha256 `8684f4b0…16f968`), built on macOS with Apple clang, statically linked with libogg 1.3.5 and libvorbis 1.3.7 (official xiph.org tarballs, hashes in the build script), native AAC encoder.
- Configure flags: `--cc=clang --disable-autodetect --disable-doc --disable-ffplay --disable-ffprobe --enable-libvorbis --enable-static --disable-shared --pkg-config-flags=--static` plus prefix, include and library paths. **`--enable-gpl`, `--enable-nonfree` and `--enable-version3` are not passed.**
- The built binary (sha256 `468833134308b22bc67dde18016cc3a9fae1d93d839f54581dab5fa4cd5c1744`, the same hash the packs record) prints, for `ffmpeg -L`, "GNU Lesser General Public License … version 2.1 of the License, or (at your option) any later version". Observed on 2026-11-22.
- libvorbis 1.3.7's `configure` was edited with `sed` to drop `-force_cpusubtype_ALL`; no codec source changed (patched `configure` sha256 `c1991118…864130`).
- **What the game ships:** audio files (Ogg Vorbis and AAC/M4A) encoded with this build. The FFmpeg binary is a build tool; it is not shipped, and the build lives under the git-ignored `tools/.toolchains/`.
- Not recorded in the repository: the licence text of libogg and libvorbis (statically linked into the binary, not into the game).

For the owner: whether any obligation follows from shipping audio encoded by an LGPL build is not decided here.

## 3. PixelLab output terms

- Public terms: <https://pixellab.ai/termsofservice> (redirects to `https://www.pixellab.ai/termsofservice`). Read on 2026-11-22; the page says "Last Updated: 2026-10-30".
- Clause 1.3: "You own the copyrights to your creations, permitting usage for both commercial and non-commercial purposes with no need for permission."
- Clause 3.3: "You retain ownership of any content you create using PixelLab. You are free to use, modify, and distribute the outputs from our tools for any purpose, except for training other models without our explicit permission. However, you bear full legal responsibility for ensuring that the content you create complies with all applicable laws and does not infringe on the rights of any third parties."
- Clause 4.1 says users must comply with the Open RAIL-M license (linked from the terms). That licence was not read for this record.
- **Plan tier.** For the characters generated on 2026-11-22: the owner's PixelLab subscription is "Tier 1: Pixel Apprentice", active on 2026-11-22. Source: the owner's own account page, shown to the orchestrator in chat (session tien-nghich-2d-1) and relayed to this worker; recorded 2026-11-22. For the 24 older PixelLab characters and the two from PR #56: the tier at their generation time is **not recorded**; all that is known is that the owner's account was on this tier on 2026-11-22. The terms page read here does not distinguish tiers, and no legal conclusion is drawn. No usage numbers or account identifiers are recorded.
- 24 assets in the ledger carry the "retired tool" origin (PixelLab). PixelLab remains retired apart from the owner's use of the remaining credits on 2026-11-22.
