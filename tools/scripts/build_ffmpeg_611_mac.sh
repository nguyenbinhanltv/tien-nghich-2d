#!/usr/bin/env bash
# Build FFmpeg 6.1.1 (libvorbis 1.3.7 + native AAC) from official upstream tarballs on macOS.
# Installs nothing system-wide and never touches Homebrew or PATH: everything goes under
#   <main checkout>/tools/.toolchains/ffmpeg-6.1.1/   (git-ignored by the committed .gitignore)
# Usage: tools/scripts/build_ffmpeg_611_mac.sh [native|nofma|x86]
#   native  arm64, default flags                      -> prefix/
#   nofma   arm64, -ffp-contract=off                  -> prefix-nofma/
#   x86     x86_64 + NASM 3.02 asm, runs under Rosetta -> prefix-x86/
# See docs/AUDIO_TOOLCHAIN_MAC.md for the recorded hashes and the --check result.
set -euo pipefail
VARIANT="${1:-native}"
ROOT="$(git rev-parse --git-common-dir)/.."; ROOT="$(cd "$ROOT" && pwd)"
B="$ROOT/tools/.toolchains/ffmpeg-6.1.1"
case "$VARIANT" in
  native) P="$B/prefix"; CF="-O2"; ARCHF=();;
  nofma)  P="$B/prefix-nofma"; CF="-O2 -ffp-contract=off"; ARCHF=();;
  x86)    P="$B/prefix-x86"; CF="-O2 -arch x86_64"; ARCHF=(--arch=x86_64 --enable-cross-compile --target-os=darwin);;
  *) echo "unknown variant $VARIANT" >&2; exit 2;;
esac
mkdir -p "$B/dl" "$B/dl-nasm" "$B/src-$VARIANT"
fetch() { # url sha256
  local f; f="$(basename "$1")"
  [ -f "$f" ] || curl -sSfLO "$1"
  echo "$2  $f" | shasum -a 256 -c -
}
cd "$B/dl"
# ffmpeg.org publishes no checksum file; this hash matches Homebrew/homebrew-core commit c7051dc8 (ffmpeg 6.1.1).
fetch https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz 8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968
fetch https://downloads.xiph.org/releases/ogg/libogg-1.3.5.tar.xz c4d91be36fc8e54deae7575241e03f4211eb102afb3fc0775fbbc1b740016705
fetch https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b
export PKG_CONFIG_LIBDIR="$P/lib/pkgconfig" PKG_CONFIG_PATH="" CFLAGS="$CF"
CCX="clang"; [ "$VARIANT" = x86 ] && CCX="clang -arch x86_64"
if [ "$VARIANT" = x86 ]; then
  cd "$B/dl-nasm"
  fetch https://www.nasm.us/pub/nasm/releasebuilds/3.02/nasm-3.02.tar.xz 87336eba53b4acfe917424ab5d500d2b0054d9f5148d35c2273ccf2cfb712f0d
  cd "$B/src-$VARIANT" && tar xf "$B/dl-nasm/nasm-3.02.tar.xz"
  (cd nasm-3.02 && ./configure --prefix="$P" && make -j8 && make install)
  export PATH="$P/bin:$PATH"
fi
cd "$B/src-$VARIANT"
for t in ffmpeg-6.1.1 libogg-1.3.5 libvorbis-1.3.7; do tar xf "$B/dl/$t.tar.xz"; done
(cd libogg-1.3.5 && ./configure --prefix="$P" --disable-shared --enable-static CC="$CCX" && make -j8 && make install)
# libvorbis 1.3.7 configure passes a PowerPC-era flag Apple's linker rejects; drop it (build flag only, no codec source change).
(cd libvorbis-1.3.7 && sed -i '' 's/-force_cpusubtype_ALL//g' configure &&
  ./configure --prefix="$P" --disable-shared --enable-static --disable-docs --disable-examples --disable-oggtest CC="$CCX" &&
  make -j8 && make install)
(cd ffmpeg-6.1.1 && ./configure --prefix="$P" --cc=clang ${ARCHF[@]+"${ARCHF[@]}"} --disable-autodetect --disable-doc \
  --disable-ffplay --disable-ffprobe --enable-libvorbis --enable-static --disable-shared --pkg-config-flags=--static \
  --extra-cflags="$CF -I$P/include" --extra-ldflags="${CF//-O2/} -L$P/lib" && make -j8 && make install)
shasum -a 256 "$P/bin/ffmpeg"
"$P/bin/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -E 'libvorbis|[[:space:]]aac[[:space:]]'
