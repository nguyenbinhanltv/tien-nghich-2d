# Fonts

Two open fonts, both under the SIL Open Font License 1.1 (full text next to each font: `OFL-display-serif.txt`, `OFL-pixel-mono.txt`). They are loaded by `../tokens.css` with `font-display: swap` and a system fallback, so the studio is fully usable before or without them. Chosen only after checking every Vietnamese letter (a ă â e ê i o ô ơ u ư y, upper and lower case, with all five tone marks, and đ Đ) in the font file; Pixelify Sans was rejected because it lacks 96 of them (all of ƠơƯư and the dotted/hooked vowels).

| File | Role | Font | Version | Source (pinned to a commit of google/fonts) |
|---|---|---|---|---|
| `display-serif.woff2` | headings, page and card titles | Lora (variable, weight 400-700) | 3.008 | https://github.com/google/fonts/blob/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/lora/Lora%5Bwght%5D.ttf |
| `pixel-mono.woff2` | ids, numbers, keys | VT323 | 2.000 | https://github.com/google/fonts/blob/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/vt323/VT323-Regular.ttf |

SHA-256 of the files as downloaded (TTF) and as shipped here (woff2):

| | original TTF | shipped woff2 | size |
|---|---|---|---|
| Lora | `822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7` | `c404754ff7a55428f8fe1816bce6d809e80618eff9bf56ab059cd24b278eebf9` | 46040 bytes (original 212196) |
| VT323 | `cf4de751ada78ceac033dbe16a687742939995b77bc2a052ae17a4957958594d` | `dfdd74f185942fad54f62ca329cd1c4ddda573dae9a687759685cb8b2a220f0c` | 23580 bytes (original 153116) |

Copyright lines: Lora: "Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name Lora". VT323: "Copyright 2011, The VT323 Project Authors (peter.hull@oikoi.com)".

## How the files were made

Subset to Basic Latin, Latin-1, Latin Extended-A, ƠơƯư (U+01A0-01A1, U+01AF-01B0), the combining marks and Vietnamese block (U+0300-0304, 0308-0309, 0323, 0329, U+1EA0-1EF9), common punctuation and the dong sign, keeping all layout features (mark positioning is what stacks Vietnamese tone marks), with fontTools 4 `pyftsubset --flavor=woff2` in a throw-away virtual environment outside the repository (the project's own venv has no fontTools). Unicode ranges used:

```
U+0020-007E,U+00A0-00FF,U+0100-017F,U+0192,U+01A0-01A1,U+01AF-01B0,U+02C6,U+02DC,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2039-203A,U+20AB,U+2212
```

Lora carries a Reserved Font Name, and a subset is a modified version, so the family name inside the subset woff2 was changed to "Pixel Kiln Display"; the CSS family names are `Pixel Kiln Display` and `Pixel Kiln Mono`. VT323 has no reserved name. Not covered (not needed): arrows and anything outside the ranges above. To change a font, repeat the subset from the pinned source and update this file.
