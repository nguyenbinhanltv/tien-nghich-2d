Lora (variable 400-700), subset with Vietnamese coverage, family renamed "Pixel Kiln Display" (Reserved Font Name rule).
Copied unchanged from studio/ui/fonts/ (see the README there for source, version, SHA-256). SIL OFL 1.1: OFL-display-serif.txt.
Used for sharp (device-resolution) text: menus, titles, dialogs, the rotate screen. In-match HUD uses the pixel font at 384x216 (E8.1/E8.2).

## Pixel font (HUD, 384x216): owner art approval

The pixel font with Vietnamese diacritics is not a file here: it is code-drawn in `game/src/ui/pixel-font.ts` (#184, bit rows composed at run time) and belongs to the game, not to the Kiln asset system, so it has no entry in `assets/review/art_approvals.json`. This section is its record.

- **Approved by:** the project owner (chủ dự án), art approval.
- **When:** 2026-11-23 22:47 (+07:00), in chat to the orchestrator (session tien-nghich-2d-1), as item 3 of four review questions.
- **Statement (verbatim, the answer to all four items):** "1. Duyệt / 2. Tôi đã nghe thử và duyệt / 3. Duyệt / 4. Duyệt". Item 3 is "Duyệt".
- **Covers:** the glyph art of `game/src/ui/pixel-font.ts` as it is on main (commit 76139356): Latin letters, digits, and the Vietnamese precomposed letters (circumflex, breve, horn, tone marks, dot below). Recorded by an agent (worker tien-nghich-2d-86) that only transcribed the statement; it did not look at the font or approve anything.
- **Does not cover:** `display-serif.woff2` (Lora, sharp text; unchanged, record of its source is in `studio/ui/fonts/`), the HUD layout, the app icon, or any change to the glyph bit rows after this commit.
