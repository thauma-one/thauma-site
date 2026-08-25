-- 0024_video_links.sql — the buttons under a partner's video shelf
--
-- WHAT THIS IS FOR. chaseroush.com puts one under its player: "View All
-- Updates on YouTube →". It is the most useful thing on that section — a
-- visitor who watched one video wants the channel, or the newsletter, or the
-- giving page — and every partner will want a slightly different set.
--
-- OPTIONAL, AND OFF BY DEFAULT BY BEING EMPTY. No rows means no buttons, which
-- is the right default: a video shelf with an empty button rail under it looks
-- unfinished, and a partner who has nothing to link to should not have to
-- switch anything off.
--
-- THE SAME SHAPE AS contact_topics, deliberately. A short ordered list a
-- partner edits as a set, replaced wholesale on save rather than diffed. One
-- pattern learned twice is cheaper than two patterns learned once.
--
-- WHY THE URL IS NOT VALIDATED HERE. SQLite cannot express "http or https
-- only", and a CHECK that half-expresses it is worse than none — it reads as
-- a guarantee. The scheme is enforced where it can be enforced properly: in
-- the console before it is stored, and again in the widget before it becomes
-- an href. See MAX/isSafeUrl in workers/src/staff-videos.js.

CREATE TABLE video_links (
  id          TEXT PRIMARY KEY,

  -- NULL is the ORGANISATION, as everywhere else in this schema.
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,

  -- What the button says. Their words, in their language.
  label       TEXT NOT NULL,

  -- Where it goes. Absolute, http(s) only — see the note above.
  url         TEXT NOT NULL,

  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_video_links ON video_links (partner_id, sort_order);

-- One label once per owner. Two buttons reading "YouTube" is a rail that looks
-- broken, and COALESCE is needed because SQLite treats NULLs as distinct in a
-- UNIQUE index — without it the organisation could have both.
CREATE UNIQUE INDEX idx_video_links_unique
  ON video_links (COALESCE(partner_id, '~organisation'), label);
