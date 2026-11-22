#!/usr/bin/env bash
# Pixel Kiln: capture 9 tabs x EN/VI x 4 widths = 72 screenshots with the Orchestrator Browser panel.
# Needs a worker session (AO_SESSION_ID set), the Browser panel visible, and the studio server running:
#   node studio/serve.mjs --port 4173
#   studio/ui/tests/capture-viewports.sh [out-dir] [base-url]
# Env: TABS, LANGS, WIDTHS (space separated) narrow the run; HEIGHT (default 720) is the iframe height.
# Images go to out-dir (default: a fresh directory under the system temp dir), never into the repo.
# A report.tsv next to the images lists, per shot, the harness verdict: overflowX px and offending elements.
set -u
OUT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/pixel-kiln-viewports.XXXXXX")}"
BASE="${2:-http://127.0.0.1:4173}"
TABS="${TABS:-overview characters objects vfx audio review jobs sandbox atlas}"
LANGS="${LANGS:-en vi}"
WIDTHS="${WIDTHS:-1600 1280 900 420}"
HEIGHT="${HEIGHT:-720}"
command -v ao >/dev/null || { echo "ao is not on PATH: run this from an Orchestrator worker session" >&2; exit 2; }
mkdir -p "$OUT"
printf 'tab\tlang\twidth\tverdict\tfile\n' > "$OUT/report.tsv"
n=0; fail=0
for tab in $TABS; do for lang in $LANGS; do for w in $WIDTHS; do
  file="$OUT/${tab}_${lang}_${w}.png"
  url="$BASE/studio/ui/tests/viewport-harness.html?tab=$tab&lang=$lang&w=$w&h=$HEIGHT&fit=1&capture=1"
  if [ -e "$file" ]; then rm -f "$file"; fi
  ao browser open "$url" >/dev/null 2>&1
  ao browser wait --selector 'body[data-ready="true"]' --timeout 20000 >/dev/null 2>&1 || echo "  (no ready signal for $tab $lang $w)" >&2
  verdict="$(ao browser get title 2>/dev/null | grep -E '^(READY|TIMEOUT)' | head -1)"
  if ao browser screenshot "$file" >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\t%s\n' "$tab" "$lang" "$w" "${verdict:-unknown}" "$(basename "$file")" >> "$OUT/report.tsv"
    n=$((n+1)); echo "[$n] $tab $lang $w: ${verdict:-unknown}"
  else
    fail=$((fail+1)); echo "screenshot failed: $tab $lang $w (is the Browser panel visible?)" >&2
  fi
done; done; done
echo "done: $n images, $fail failed, in $OUT"
[ "$fail" -eq 0 ]
