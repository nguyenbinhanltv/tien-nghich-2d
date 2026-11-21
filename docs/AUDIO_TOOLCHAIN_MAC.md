# Audio codec toolchain on macOS (FFmpeg 6.1.1)

**Findings.** An FFmpeg 6.1.1 with libvorbis and native AAC-LC was built here from official sources. It cannot reproduce the approved Windows packs byte for byte: `--check` fails for `pilot_v1` and `wave2_batch1_v1` on every codec file. The approved packs and their builders are untouched.

## Decision: per-pack pinned toolchains (chosen 2026-11-22)

Taken by the orchestrator under the user's delegated authority; reversible.

1. **Approved packs stay Windows-pinned.** `pilot_v1` and `wave2_batch1_v1` are not re-encoded and their `--check` is not relaxed.
2. **New packs are built on this Mac** and each records its own toolchain (variant, binary SHA-256, source tarball hashes, libvorbis build note, configure flags) in `pack.json` and `PACK_REPORT.md`. Its `--check` is byte-exact on that same toolchain. Current packs: `wave2_batch2_v1`, `wave2_batch3_v1`, `wave2_batch4_v1`, all built by `tools/scripts/build_audio_wave2_pack.py --batch 2|3|4 --ffmpeg <native ffmpeg>` (one parameterised builder; it refuses non-`native` binaries).
3. **One variant for all new packs: `native` (arm64).** The x86-under-Rosetta build was measured closest to the Windows output, but it is still not byte-identical, so it buys nothing for a pack whose `--check` runs on its own toolchain. `native` needs no Rosetta (Apple is phasing it out) and no extra NASM build, and any Apple Silicon machine can rebuild it with one script. The cost: its output depends on Apple clang's floating-point code generation, so a different compiler major version may not reproduce the bytes; `--check` then prints a toolchain note instead of hiding it.
4. **Cross-toolchain equivalence check, separate and read-only:** `tools/scripts/check_audio_pack_equivalence.py --pack <id> --ffmpeg <ffmpeg>`. It rebuilds into a scratch directory and requires identical decoded frame counts, decoder head offsets, SFX cue markers and BGM loop markers, a byte-identical lossless sprite WAV, and decoded SNR of at least **35 dB** (committed vs rebuilt) per codec file. **It does not replace `--check`**: it tolerates codec-level float differences that `--check` forbids, and it never modifies the committed pack.

### `--check` semantics for new packs
Rebuilds into a temp dir; the WAV, Ogg, M4A files must be byte-identical. `pack.json`, `evidence.json` must match apart from the machine-specific `toolchain` block, and `PACK_REPORT.md` must match. Differences inside the `toolchain` block (for example a different binary hash from an independent rebuild, or another CPython patch version) are printed as notes rather than hidden.

### Equivalence evidence on the approved packs (native binary `468833…c1744`, threshold 35 dB)
| Pack file | bytes | decoded identical | max abs diff (PCM) | SNR |
|---|---|---|---|---|
| `pilot_v1/sfx_sprite.m4a` | differ | no | 612 | 46.57 dB |
| `pilot_v1/sfx_sprite.ogg` | differ | no | 891 | 44.92 dB |
| `pilot_v1/bgm_dong_phu.m4a` | differ | no | 2675 | **36.96 dB** |
| `pilot_v1/bgm_dong_phu.ogg` | differ | no | 148 | 62.20 dB |
| `wave2_batch1_v1/sfx_sprite.m4a` | differ | no | 1 | 96.12 dB |
| `wave2_batch1_v1/sfx_sprite.ogg` | differ | no | 122 | 62.52 dB |
| `wave2_batch1_v1/bgm_hengyue.m4a` | differ | no | 535 | 46.70 dB |
| `wave2_batch1_v1/bgm_hengyue.ogg` | differ | no | 64 | 65.46 dB |

Both packs report **EQUIVALENT within thresholds** (frame counts, head offsets, cue markers and loop markers identical, sprite WAVs byte-identical). The 35 dB floor leaves only about 2 dB of margin on the weakest file (the pilot AAC BGM), so treat it as a regression tripwire, not a quality bar. Listening approval of the Windows packs does not transfer to Mac-built packs; each new pack needs its own.

## Build (recorded, reproducible)

`tools/scripts/build_ffmpeg_611_mac.sh [native|nofma|x86]` downloads, hash-verifies and builds into `tools/.toolchains/ffmpeg-6.1.1/` of the **main checkout** (git-ignored by the committed `.gitignore` entry `tools/.toolchains` (no trailing slash, so it also covers the worktree symlink); worktrees reach it through a `tools/.toolchains` symlink). Nothing is installed system-wide; Homebrew and PATH are unchanged. Host: macOS 15 (Darwin 24.1), Apple clang 16.0.0, arm64.

| Source | SHA-256 | Verified against |
|---|---|---|
| `ffmpeg-6.1.1.tar.xz` (ffmpeg.org) | `8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968` | Homebrew/homebrew-core commit `c7051dc8` formula for ffmpeg 6.1.1 (ffmpeg.org publishes no checksum file; no `gpg` on this Mac, so the `.asc` signature was **not** checked) |
| `libogg-1.3.5.tar.xz` (xiph.org) | `c4d91be36fc8e54deae7575241e03f4211eb102afb3fc0775fbbc1b740016705` | xiph.org `SHA256SUMS` |
| `libvorbis-1.3.7.tar.xz` (xiph.org) | `b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b` | xiph.org `SHA256SUMS` |
| `nasm-3.02.tar.xz` (nasm.us, x86 variant only; assembler) | `87336eba53b4acfe917424ab5d500d2b0054d9f5148d35c2273ccf2cfb712f0d` | Homebrew nasm formula |

One deviation from pristine sources: libvorbis 1.3.7's generated `configure` is edited with `sed` to drop `-force_cpusubtype_ALL` (a PowerPC-era flag Apple's linker rejects). It is a build flag only; no codec source changes (patched `configure` SHA-256 `c1991118ed159631298a5ce620afe7f1fb059854473ca12774e3f224fb864130`).

FFmpeg configure (all variants): `--cc=clang --disable-autodetect --disable-doc --disable-ffplay --disable-ffprobe --enable-libvorbis --enable-static --disable-shared --pkg-config-flags=--static` plus `--prefix`/include/lib paths. Static libogg/libvorbis. `--disable-autodetect` keeps Homebrew libraries out. Reports `Xiph.Org libVorbis 1.3.7`; encoders `libvorbis` and `aac` present.

| Variant | Binary SHA-256 |
|---|---|
| `native` (arm64) | `468833134308b22bc67dde18016cc3a9fae1d93d839f54581dab5fa4cd5c1744` (script-built; an earlier manual build with default library flags, `878b0eef…ad68d`, failed `--check` the same way) |
| `nofma` (arm64, `-ffp-contract=off`) | `8584505cb67e2332c9a2b7b84b76a555402c7fc822a55fe5c2380416030a9c0a` |
| `x86` (x86_64 + NASM asm, Rosetta 2) | `4a42ebdb8bc1a18529000494271a985461cac8c595cfb6667df56ecf6872838c` |

The pinned Windows binary (gyan.dev essentials 6.1.1, SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`) is not available here, so comparison is against the committed pack outputs it produced.

## `--check` result

The original investigation, run with `build_audio_pilot_pack.py` and `build_audio_wave2_batch1_pack.py --check`. Every variant fails the same set of files.

| File | native | nofma | x86 (Rosetta) |
|---|---|---|---|
| `sfx_sprite_master.wav` (both packs) | identical | identical | identical |
| every `*.ogg` and `*.m4a` (8 files) | **differ** | **differ** | **differ** |
| `pack.json` (both packs) | differ | differ | differ |
| `evidence.json` pilot | differ | differ | differ |
| `evidence.json` batch 1 | differ | differ | **identical** |

`pack.json` can never match across builds as written: it embeds the FFmpeg banner (`6.1.1-essentials_build-www.gyan.dev` vs `6.1.1`), apart from the hashes of differing codec files.

## Size of the difference (committed Windows file vs this Mac, FFmpeg-decoded, PCM16)

Frame counts and decoder-delay behaviour are identical everywhere (same decoded lengths, 0-frame head offset). Container layout matches (Ogg headers, M4A `ftyp`/`free`/`mdat`). File sizes differ: Ogg by at most 39 B (native) or 5 B (nofma/x86); SFX M4A by 2 B to 157 B; BGM M4A by up to 0.19 % (`bgm_dong_phu.m4a` −0.12 kB to +3.0 kB, `bgm_hengyue.m4a` −0.85 kB to +0.85 kB depending on variant).

x86 under Rosetta, the closest variant overall (native and nofma ranges follow the table):

| Pack file | decoded identical | max abs diff (PCM) | SNR committed vs Mac |
|---|---|---|---|
| pilot `sfx_sprite.ogg` | **yes** (file bytes still differ) | 0 | inf |
| pilot `sfx_sprite.m4a` | no | 9 | 87.2 dB |
| pilot `bgm_dong_phu.ogg` | no | 88 | 68.0 dB |
| pilot `bgm_dong_phu.m4a` | no | 947 | 38.5 dB |
| batch 1 `sfx_sprite.ogg` | no | 122 | 62.8 dB |
| batch 1 `sfx_sprite.m4a` | no | 1 | 106.9 dB |
| batch 1 `bgm_hengyue.ogg` | no | 47 | 72.7 dB |
| batch 1 `bgm_hengyue.m4a` | no | 489 | 44.8 dB |

The default arm64 build gives SNR 37.0 dB to 96.1 dB on the same files (Ogg 44.9 to 65.5 dB, M4A 37.0 to 96.1 dB; re-measured with the script-built binary); `nofma` gives 39.2 dB to inf. These differences are well below each codec's own error versus the masters (Ogg 11.81–36.27 dB SNR, M4A 13.44–57.02 dB per cue in the batch 1 report). The differences are float-rounding-level divergences in the encoders (FMA contraction on arm64, SIMD paths on x86), amplified by bit-reservoir/rate decisions, not a different codec, container, delay or loop-point behaviour.

## Options considered (2026-11-22 choice: per-pack pinned toolchains, above)

1. Keep Windows as the packing authority for everything. 2. Re-pin approved packs to a Mac build and re-approve by listening. 3. Run the pinned Windows binary via Wine or CI. 4. Relax `--check` to a tolerance (now offered only as the separate equivalence check). 5. Record the Windows binary's libvorbis version and build flags, the one unknown that could close the Ogg gap.

Listening status: **pending** for every Mac-built pack; no agent can listen.
