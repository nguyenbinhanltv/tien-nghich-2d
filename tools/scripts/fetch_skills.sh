#!/usr/bin/env bash
# Re-create tools/skills/<repo> clones at the pinned SHAs (clone only; runs nothing from them).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Each line: <url> <full commit SHA> [directory name]. The directory defaults to the URL basename;
# give a third column when that basename is too generic (anthropics/skills -> anthropic-skills).
while read -r url sha dirname; do
  name="${dirname:-$(basename "$url")}"; dir="$ROOT/tools/skills/$name"
  [ -d "$dir/.git" ] && { echo "skip $name (exists)"; continue; }
  git clone "$url" "$dir"; git -C "$dir" checkout --detach "$sha"
done <<'LIST'
https://github.com/GenielabsOpenSource/spine-animation-ai 702b71689cac826efee942ee4564fef9560d6ef8
https://github.com/digitalhobbit/assetcat 8784327edb240e3b940bd28901c6f994beaf78cc
https://github.com/HoangLong256/spritefx e5867cc05f6e1dc6207b8e1c3c65cef75e6ba51a
https://github.com/0x0funky/agent-sprite-forge 25203d03900b46b444bdd72a75768c33d1895ad6
https://github.com/anthropics/skills e4bb5d960d87126ff3b3a8af1a104b7db67560ba anthropic-skills
LIST
