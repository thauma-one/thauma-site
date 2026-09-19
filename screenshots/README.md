# screenshots/

Scratch space for `chromium --headless` renders of the dev site, so a session scoped to
this repo can *see* a page without being given access anywhere else on the Pi. Everything
here except this README is gitignored — delete freely. An image worth keeping goes in
`src/img/` or `docs/` with a real name.

Needs `thauma-dev.service` running (wrangler on 127.0.0.1:8991; the LAN bridge is 8992).

## The command

```bash
chromium --headless --disable-gpu --hide-scrollbars \
  --virtual-time-budget=10000 \
  --window-size=1440,900 \
  --screenshot=screenshots/home.png \
  http://127.0.0.1:8991/en/
```

**`--virtual-time-budget` is the part that matters here.** Every on-load animation is
gated behind `whenPageSettled` (see the motion system in CLAUDE.md), so a plain
`--screenshot` catches a half-played frame: dim wordmark, headline and body still hidden,
scroll reveals unfired. It looks like broken CSS and is not. 10000 (ms of virtual time)
is enough for the hero and the first scroll batch.

## Sizes worth using

| What | `--window-size` |
|---|---|
| Desktop | `1440,900` |
| Full page (chromium captures the viewport only — make it tall) | `1440,4000` |
| Phone | `390,844` |

## Notes

- `ERROR:...page_load_metrics...Invalid first_paint` on stderr is noise; the PNG is fine.
- Screenshot the language you mean: paths are `/en/`, `/hr/`, `/sr/`.
- The dev server serves the UNGATED site (`ELEVENTY_RUN_MODE=watch`), so interior pages
  render even while `comingSoon` is true in production.
