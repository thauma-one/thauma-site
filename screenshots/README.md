# screenshots/

Scratch space for `chromium --headless` renders of the dev site, so Claude Code can
*see* a page without being given access outside this repo.

    chromium --headless --disable-gpu --hide-scrollbars \
      --window-size=1440,900 \
      --screenshot=screenshots/home.png \
      http://127.0.0.1:8991/en/

Everything here except this README is gitignored. Delete freely.
