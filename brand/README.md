# Thauma — brand graphics package

Everything needed to use the Thauma logo, symbol and favicon on the web, in print and on merch.
If you're handing this to Claude Code to update the website, give it **`claude-code-instructions.md`**.
Open **`preview/index.html`** (or `preview/brand-sheet.png`) to see every file at a glance.

---

## 1. The logo

**THAUMA** in Sora Thin (weight 100), all caps, letter-spaced 0.42em: the same wordmark the website already uses.
Three lines complete it:

- **The arriving line** comes in from the left, passes through the T and **becomes the crossbar of the H**.
- **Two closing lines** sit after the word. Each one is shorter and lighter than the one before it.
- **The fade.** The outer third of each line fades out, so the lines feel like they keep going past what you can see.

The letters are traced from the actual font, and every line is drawn at the font's own stroke weight.
Nothing in the logo depends on having the font installed.

### Versions

| File (in `logo/svg/` and `logo/png/`) | Use it for |
|---|---|
| `thauma-logo-white` | **Primary.** Any dark background: website, slides, video, social. |
| `thauma-logo-black` | Light backgrounds: documents, letterhead, light pages. |
| `thauma-logo-color-blue` | Website and digital only. The line runs through the H in the accent color. |
| `thauma-logo-color-seafoam` | Same, in the seafoam accent. |
| `thauma-logo-white-solid` / `-black-solid` | **Printing:** shirts, stickers, embroidery, engraving. No fade (see §5). |
| `thauma-logo-white-on-black` / `-black-on-white` / `-color-on-site` | Ready-made tiles with a background and clear space built in, for quick drops into decks and posts. |

PNGs come in 600, 1200 and 2400 px wide. Backgrounds are transparent unless the name says "on".

### Clear space and size
- Keep empty space around the logo equal to **the height of the capital letters** on every side.
- Don't use the full logo smaller than **120 px wide** on screen or **35 mm wide** in print.
  Below that the thin letters break up, so use the symbol instead.

### Don't
- Change the font, the letter-spacing, or the line lengths and weights.
- Put the colored version on a light background.
- Add shadows, glows, outlines or gradients beyond the built-in fade.
- Stretch it, or rebuild it from live text. Always use the supplied files.

---

## 2. The symbol

An upright and the two lighter closing lines from the logo, **cut out of a solid shape**.
The solid shape is what keeps it readable at small sizes.
It comes in six shapes, each in four colorways.

| Shape | File name part |
|---|---|
| K1 · rounded square (**primary; used for the favicon**) | `rounded` |
| K2 · circle | `circle` |
| K3 · square | `square` |
| K4 · bold marks, no border | `bold` |
| K5 · thin frame around the marks | `frame` |
| K6 · shape split top to bottom by the upright | `split` |

| Colorway | File name part |
|---|---|
| White on transparent | `white` |
| Black on transparent | `black` |
| White on black | `white-on-black` |
| Black on white | `black-on-white` |

Example: `symbol/svg/thauma-symbol-rounded-white.svg`. PNGs come in 512 and 1024 px.
The "on" colorways include padding. The transparent ones are cropped tight to the shape.

Use the symbol when there's no room for the full logo: social avatars, favicons, stickers, shirt sleeves or back necks, watermarks.
In a cut-out symbol the marks are holes, so whatever sits behind the symbol shows through them.

---

## 3. Favicon and app icons (`favicon/`)

| File | Purpose |
|---|---|
| `favicon.svg` | Modern browsers. **Switches itself:** white in dark mode, black in light mode. |
| `favicon.ico` | Fallback for older browsers (16/32/48, black). |
| `favicon-16/32/48.png` | Individual PNG sizes, black on transparent. |
| `apple-touch-icon.png` | iPhone/iPad home screen (180 px; white symbol on black). |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Android / installable-site icons. |
| `site.webmanifest` | Lists the icons above. |
| `head-snippet.html` | The tags to paste into the site's `<head>`. |

---

## 4. Colors and type

| Role | Hex |
|---|---|
| Site background | `#0B0F15` |
| Text on dark | `#EDF2F8` |
| Pure white / black (logo, symbol) | `#FFFFFF` / `#000000` |
| Accent — blue | `#2FD8FF` |
| Accent — seafoam | `#5CF2C4` |

The primary logo is white on black. Color is optional, for digital use only.

**Typeface:** Sora (Google Fonts). Thin 100 for the wordmark, letter-spacing 0.42em, uppercase.

---

## 5. Printing (shirts, merch)

Screen printing can't reproduce a true fade. A printer would turn it into a dot pattern,
which looks rough on lines this thin. **Use the `-solid` logo files for anything printed.**
The symbol has no fade, so every symbol file prints as-is.

The logo's lines are very fine. On fabric, print the full logo at least **25 cm (10 in) wide**,
or use the symbol (K1 or K4 hold up best) for small placements. Send printers the **SVG**.

---

## 6. Web files (`web/`)

- `thauma-logo-currentcolor.svg`: the logo using `currentColor`, so it takes the text color of whatever it sits in. Paste it inline in HTML.
- `thauma-logo-currentcolor-thread.svg`: the colored version. Letters follow `currentColor`; the line color comes from the CSS variable `--logo-accent` (default `#2FD8FF`).

## 7. Geometry (for anyone redrawing or animating)

Units are 1/1000 em of Sora Thin, with cap height 0–730 and the word starting at x = 0.

- Arriving line: x −1450 → 1150, centered on y 370, 30 thick. It fades in over its first 30%. The H crossbar is y 355–385.
- Closing line 1: starts x 7012, length 700, 22 thick, centered on y 370.
- Closing line 2: starts x 7012, length 350, 12 thick, centered on y 480.
- Each closing line fades out over its last 30%.
