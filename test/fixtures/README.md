# test/fixtures — content the tests assert against

**These are permanent, committed files. They are not written into
`src/content/` and never were meant to be.**

An earlier version of the events test created gatherings inside the real
content folder, built the site, asserted, and deleted them again. Everything
about that was wrong: the live dev site briefly grew events nobody wrote,
anybody looking at it mid-run saw them appear and vanish, and the rendered
output ended up quoted in conversation as though it were the real page. It cost
hours of "where did those events go".

`src/_data/gatherings.js` and `resources.js` read `THAUMA_CONTENT_DIR` when it
is set, so a test points the build here instead. The real content folder is
written to by the console and by nothing else.

The fixtures deliberately cover the cases real content will not always have:
a multi-day gathering, a cohort with a cadence, a past entry for the record,
and an item with only a Croatian title.
