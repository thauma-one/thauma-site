-- 0050_email_look.sql — what a ministry's email looks like
--
-- Chase, 2026-10-04: "each ministry's email should be built from the site's
-- design, but an email designer may be good too! That way they have complete
-- transparency as to what they have access to."
--
-- NULL means the default: follow the published website (lib/email-look.js),
-- or, for a ministry without one, the plain email in its colors. Otherwise a
-- small JSON object of the designer's choices:
--   { follow, mode, font, header, corners, bar, footer, site }
-- cleaned by cleanEmailLook() on every read, so an old or odd value can only
-- ever mean one of the offered choices.
--
-- Additive: reverting the code strands nothing.

ALTER TABLE partners ADD COLUMN email_look TEXT;
