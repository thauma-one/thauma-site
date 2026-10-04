-- 0048_test_inboxes.sql — where a person's "Send me a test" goes
--
-- Found 2026-10-03: every test landed in Gmail's spam while the same mailing,
-- really sent, reached the inbox. Proved by sending the identical message
-- straight to the Gmail address: inbox. The difference is the route. A test
-- goes to the SIGN-IN address (chase.roush@thauma.one), thauma.one has no
-- mailbox, and Cloudflare Email Routing forwards it into Gmail, which
-- distrusts forwarded bulk mail from a sender it has not learned yet.
--
-- So a person may name ONE more address for their tests, their real inbox.
-- It is PROVEN before it is used: Thauma emails it a link, and only a
-- confirmed address receives tests. Without that, the box would be a way to
-- send an unsent newsletter to anybody while calling it a test (the reason
-- tests went only to the sign-in address in the first place).
--
-- email         the address asked for
-- confirmed_at  NULL until the link is followed; tests go here only after
--
-- No token column: the link is signed (lib/signed-link.js, as the change of
-- sign-in address does), with the account AND the address inside the
-- signature, so nothing secret is stored and a link confirms one address.
--
-- One row per person. Additive: reverting the code strands nothing, and
-- tests fall back to the sign-in address.

CREATE TABLE test_inboxes (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL COLLATE NOCASE,
  created_at    TEXT NOT NULL,
  confirmed_at  TEXT
);
