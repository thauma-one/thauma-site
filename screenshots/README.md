# screenshots/

Scratch space for `chromium --headless` renders of the dev site, so a session scoped to
this repo can *see* a page without being given access anywhere else on the Pi. Everything
here except this README is gitignored, and pruned automatically (see Cleanup). An image
worth keeping goes in `src/img/` or `docs/` with a real name.

Needs `thauma-dev.service` running (wrangler on 127.0.0.1:8991; the LAN bridge is 8992).

## The command

```bash
chromium --headless --disable-gpu --hide-scrollbars \
  --window-size=1440,900 \
  --screenshot=screenshots/home.png \
  http://127.0.0.1:8991/en/
```

That fires as soon as the page finishes loading — no waiting, which is what you want for
checking layout, type and color.

| What | `--window-size` |
|---|---|
| Desktop | `1440,900` |
| Full page (chromium captures the viewport only — make it tall) | `1440,4000` |
| Phone | `390,844` |

## Seeing motion

The site holds every on-load animation until the page settles (the motion system in
CLAUDE.md), so the frame above is often the *pre-animation* state: wordmark dim, headline
and body still hidden. That is the page working, not broken CSS.

To read an animation, capture a series. `--virtual-time-budget` is a clock, not a wait:
the browser runs time forward as fast as it can and shoots at that mark, so a dozen frames
across a 4-second sequence cost a few real seconds.

```bash
for ms in 0 150 300 450 600 900 1200 1600 2000 2600 3200 4000; do
  chromium --headless --disable-gpu --hide-scrollbars \
    --window-size=1440,900 --virtual-time-budget=$ms \
    --screenshot="screenshots/hero-$(printf '%05d' $ms).png" \
    http://127.0.0.1:8991/en/ 2>/dev/null
done
```

Zero-padded names so they sort in order. Tighten the spacing where the movement is (the
character cascade and page wheel are ~1.3 s; cross-page transitions ~0.5 s).

## Cleanup

`deploy/screenshots-prune.sh`, run daily by `screenshots-prune.timer`: deletes anything
older than **30 days**, then, if the folder is still over **1 GiB**, deletes oldest-first
until it is under. Age alone would not hold — one frame-sequence loop writes hundreds of
files in minutes. `README.md` is never touched.

```bash
bash deploy/screenshots-prune.sh --dry-run     # show what would go
MAX_AGE_DAYS=7 bash deploy/screenshots-prune.sh
```

## Notes

- `ERROR:...page_load_metrics...Invalid first_paint` on stderr is noise; the PNG is fine.
- Screenshot the language you mean: paths are `/en/`, `/hr/`, `/sr/`.
- The dev server serves the UNGATED site (`ELEVENTY_RUN_MODE=watch`), so interior pages
  render even while `comingSoon` is true in production.
