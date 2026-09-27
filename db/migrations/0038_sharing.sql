-- 0038_sharing.sql — each thing on another website is shared on its own
--
-- Board 9 of the console mockups ("Everything that goes on other websites",
-- the Sharing page): six things can appear on somebody else's website — the
-- roadmap, goal progress, prayer, videos, the sign-up form and the contact
-- form — and each is Live or Not shared on its own. Until now the four data
-- widgets shared ONE switch, partners.embed_enabled, so a ministry could not
-- show its roadmap without also publishing its prayer requests.
--
--   embed_roadmap / embed_goal / embed_prayer / embed_videos
--        1 = that widget (and its part of the embed data) is public.
--        Each starts equal to embed_enabled, so every ministry sees exactly
--        what it saw before; nothing is published or withdrawn by this.
--   embed_enabled stays, and the Worker keeps it equal to "any of the four",
--        so the public route's existing gate (a ministry sharing nothing is a
--        404) still holds without a second copy of the rule.
--   signup_form_open
--        the sign-up form's own Live switch: 0 stops every copy of the form at
--        once while each list keeps its own open/closed choice for when it is
--        switched back on. Starts at 1: forms that are live today stay live.
--        (Thauma's own form has no partner row; its lists alone decide it.)
--
-- Additive: new columns, filled from what exists; nothing dropped or rewritten.

ALTER TABLE partners ADD COLUMN embed_roadmap INTEGER NOT NULL DEFAULT 0 CHECK (embed_roadmap IN (0, 1));
ALTER TABLE partners ADD COLUMN embed_goal    INTEGER NOT NULL DEFAULT 0 CHECK (embed_goal    IN (0, 1));
ALTER TABLE partners ADD COLUMN embed_prayer  INTEGER NOT NULL DEFAULT 0 CHECK (embed_prayer  IN (0, 1));
ALTER TABLE partners ADD COLUMN embed_videos  INTEGER NOT NULL DEFAULT 0 CHECK (embed_videos  IN (0, 1));
ALTER TABLE partners ADD COLUMN signup_form_open INTEGER NOT NULL DEFAULT 1 CHECK (signup_form_open IN (0, 1));

UPDATE partners
   SET embed_roadmap = embed_enabled, embed_goal = embed_enabled,
       embed_prayer = embed_enabled, embed_videos = embed_enabled;
