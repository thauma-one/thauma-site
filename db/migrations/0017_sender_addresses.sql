-- 0017_sender_addresses.sql — which addresses a partner may send from
--
-- WHY A LIST AND NOT A TEXT BOX
-- ============================================================================
-- The sender was typed by hand, and that is unsafe in a way that is invisible
-- until it matters. Resend verifies DOMAINS, not addresses: once a domain is
-- verified, every address at it sends — including a typo. So
-- `prayer.chaserosh@…` leaves successfully, looks fine in the log, and every
-- reply to it falls into nothing. Nobody finds out until somebody says "I
-- wrote back and never heard".
--
-- A chosen address cannot be mistyped. The list is the control, and it lives
-- with an administrator because adding one carries obligations outside this
-- system — the domain has to be verified in Resend, and anything expected to
-- RECEIVE has to exist as a mailbox.
--
-- ONE SENDING DOMAIN PER PARTNER, which is why the domain is on `partners`.
-- Reputation is tracked per domain, so one partner's junk reports stay with
-- that partner rather than degrading everybody's mail. The organisation's own
-- domain stays out of it entirely: an account invite must never be delayed
-- because somebody else's newsletter was reported.

-- The domain this partner's mail is sent from. NULL means "not set up yet",
-- which is the honest state for a partner created before anybody verified a
-- domain for them — and the console says so rather than inventing one.
ALTER TABLE partners ADD COLUMN sending_domain TEXT;


CREATE TABLE sender_addresses (
  id          TEXT PRIMARY KEY,

  -- NULL is the ORGANISATION, the same convention mailing_lists uses.
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,

  address     TEXT NOT NULL,

  -- What it is for, in words: "Newsletter", "Prayer", "Contact". Shown in the
  -- picker, because `news@chase-roush.thauma.one` is not self-explanatory to
  -- somebody choosing between four of them at speed.
  label       TEXT,

  -- Whether replies to it can actually arrive. Sending needs no mailbox;
  -- RECEIVING does, and only a person can know whether one was created. It is
  -- recorded rather than detected so the console can warn when a list points
  -- its replies somewhere nobody is reading.
  can_receive INTEGER NOT NULL DEFAULT 0 CHECK (can_receive IN (0, 1)),

  created_at  TEXT NOT NULL
);

-- COALESCE for the same reason as mailing_lists: SQLite treats NULLs as
-- distinct in a UNIQUE constraint, so without it the organisation could hold
-- the same address twice.
CREATE UNIQUE INDEX idx_sender_addresses_unique
  ON sender_addresses (COALESCE(partner_id, '~organisation'), address);
CREATE INDEX idx_sender_addresses_partner ON sender_addresses (partner_id);
