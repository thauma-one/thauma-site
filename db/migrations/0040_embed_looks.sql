-- 0040_embed_looks.sql — the second color by degrees, and an embed's own colors
--
-- Sharing's color picker becomes a wheel (Chase, 2026-09-27, option C): a
-- first color set by hue, saturation and brightness, and a second color that
-- either sits a fixed number of degrees round the wheel from it or is picked
-- freely. And the ministry's colors stop being the only colors: any of the
-- six embeds can wear its own instead ("Ministry colors" or "Its own").
--
-- partners.embed_turn   how far round the wheel the second color sits, in
--                       degrees: -33, 120 or 180. NULL is -33, the rotation
--                       every ministry has had until now (embed-colour.js),
--                       so nobody's colors change. Only read while
--                       embed_accent2 is NULL — a stored second color IS the
--                       free choice.
--
-- embed_looks           one row per embed that departs from the ministry:
--   kind                the six things on Sharing
--   accent              NULL = wears the ministry's colors; set = its own
--   accent2, turn       its own second color, as for the ministry's
--   theme               its own background (auto | light | dark); NULL = the
--                       ministry's embed_theme. Set independently of the
--                       colors: where the code is pasted decides it.
--
-- A ministry with no rows looks exactly as it did. Additive only; reverting
-- the code that reads this strands nothing.

ALTER TABLE partners ADD COLUMN embed_turn INTEGER
  CHECK (embed_turn IS NULL OR embed_turn IN (-33, 120, 180));

CREATE TABLE IF NOT EXISTS embed_looks (
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL
              CHECK (kind IN ('roadmap', 'goal', 'prayer', 'videos', 'signup', 'contact')),
  accent      TEXT,
  accent2     TEXT,
  turn        INTEGER CHECK (turn IS NULL OR turn IN (-33, 120, 180)),
  theme       TEXT CHECK (theme IS NULL OR theme IN ('auto', 'light', 'dark')),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (partner_id, kind)
);
