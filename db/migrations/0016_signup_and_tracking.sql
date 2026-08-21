-- 0016_signup_and_tracking.sql — public sign-ups, and what happened to a send
--
-- TWO THINGS THAT ARRIVE TOGETHER because they are the same idea from opposite
-- ends: somebody joining a list, and somebody acting on what the list sent.


-- ---------------------------------------------------------------------------
-- Click tracking
-- ---------------------------------------------------------------------------
-- CLICKS, NOT OPENS, ARE THE HONEST SIGNAL.
--
-- An open is a 1x1 image being fetched, and Apple Mail Privacy Protection
-- pre-fetches images for a large share of recipients whether or not anybody
-- looked. So "opened" over-counts by an unknown amount that varies with the
-- audience — it cannot answer "did they read it", which is the only question
-- worth asking. A click is somebody deciding to do something.
--
-- Recorded on the row that already exists per recipient, rather than in a new
-- events table: the question is "what happened to this person's copy", and
-- that is a property of their copy.
ALTER TABLE mailing_recipients ADD COLUMN opened_at  TEXT;
ALTER TABLE mailing_recipients ADD COLUMN clicked_at TEXT;
ALTER TABLE mailing_recipients ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0;

-- FIRST click and LAST, because they answer different questions: did this
-- land, and is it still being read a month later.
ALTER TABLE mailing_recipients ADD COLUMN last_click_at TEXT;

CREATE INDEX idx_mailing_recipients_clicked
  ON mailing_recipients (mailing_id, clicked_at);


-- Which links, so "what did people actually want" is answerable rather than
-- just "how many clicked". One row per link per mailing; the recipient's click
-- is counted on their own row above.
CREATE TABLE mailing_links (
  id          TEXT PRIMARY KEY,
  mailing_id  TEXT NOT NULL REFERENCES mailings(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  label       TEXT,
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_mailing_links_mailing ON mailing_links (mailing_id);


-- ---------------------------------------------------------------------------
-- Sign-up forms
-- ---------------------------------------------------------------------------
-- A form is configuration ON a list rather than its own object: a list has at
-- most one public way in, and giving it two would make "who is on this list"
-- depend on which door they used.
ALTER TABLE mailing_lists ADD COLUMN form_heading TEXT;
ALTER TABLE mailing_lists ADD COLUMN form_blurb   TEXT;
ALTER TABLE mailing_lists ADD COLUMN form_button  TEXT;

-- Where the browser is sent after subscribing. NULL means "show the built-in
-- thank-you", which is what a partner who has not thought about it should get.
ALTER TABLE mailing_lists ADD COLUMN form_thanks_url TEXT;


-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
-- PER IP, AND DELIBERATELY NOT PER LIST. Capping a list per hour would make a
-- genuine surge — a service where the ministry is spoken about, a video going
-- round — look identical to an attack, and turn away the people it worked on.
-- The abuse this needs to stop is one machine submitting repeatedly, which is
-- an IP-shaped problem.
--
-- KEPT BRIEFLY. This is a record of who visited a page, which is personal data
-- with no purpose beyond the next few minutes. The IP is stored as a HASH:
-- enough to count repeats, not enough to identify anybody, and useless to
-- somebody who takes a copy of the database.
CREATE TABLE signup_attempts (
  ip_hash    TEXT NOT NULL,
  list_id    TEXT NOT NULL,
  at         TEXT NOT NULL,
  outcome    TEXT NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'rejected', 'honeypot')),
  PRIMARY KEY (ip_hash, list_id, at)
);

CREATE INDEX idx_signup_attempts_at ON signup_attempts (at);
