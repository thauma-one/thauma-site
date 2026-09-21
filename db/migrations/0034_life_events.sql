-- ============================================================================
-- 0034_life_events.sql — what happened to a supporter, as distinct from
--                        whether anybody spoke to them about it
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- WHY THIS IS NOT A NEW `interactions` TYPE
-- ---------------------------------------------------------------------------
-- The obvious cheap move is to add 'birth' and 'bereavement' to the type list
-- on `interactions` and be done. It would be wrong, and wrong in the one way
-- this schema has been most careful about everywhere else.
--
-- An interaction is a TOUCH: somebody reached out, on a date, and that is what
-- `contact_touch` counts. A life event is a FACT ABOUT A PERSON — their father
-- died, their daughter was born — which is a REASON to reach out and is not
-- itself reaching out. Filing a bereavement as an interaction would claim the
-- partner had made contact about it, move `last_personal_contact` forward, and
-- quietly report somebody as looked after because something happened TO them.
--
-- That is precisely the conflation the bulk-versus-personal split exists to
-- prevent, one level further in. Separate table, and `contact_touch` never
-- learns this table exists.
--
-- NO FOLLOW-UP DATE, AND THAT IS A DECISION RATHER THAN AN OMISSION
-- ---------------------------------------------------------------------------
-- The first design carried `follow_up_on` and `followed_up_at`, and the
-- stewardship list was going to sort by what was due. Rejected by the founder
-- on 2026-09-21, in his words: "I don't think we need a follow up on date
-- option. That can be managed by the individual."
--
-- He is right, and the reason is worth keeping. A due date would turn pastoral
-- judgment into a ticket queue — a widow with a green tick against her name
-- because the system was satisfied on day fourteen. This table records what
-- happened and when it was learned. Whether that earns a phone call this week
-- is a person's judgment, and there is no column for judgment.
--
-- If a reminder is ever wanted, it belongs in the alerts subsystem reaching
-- OUT to a staff member, not in a status column on a supporter's grief.
--
-- THIS IS THE MOST SENSITIVE TABLE IN THE DATABASE
-- ---------------------------------------------------------------------------
-- db/README.md's second decision is "no donor PII, ever", and it holds: there
-- is still no amount anywhere. But bereavement, illness and a marriage are
-- special-category personal data under GDPR in a way a postal address is not,
-- and Croatia is in the EU.
--
-- Three consequences, all of them built in below rather than promised:
--
--   · ON DELETE CASCADE from `contacts`. Erasing a supporter erases what was
--     written about them, in the same statement, with no second step for
--     somebody to forget.
--   · `partner_id` NOT NULL and trigger-checked, so one partner can never read
--     another's, exactly as `interactions` is protected.
--   · Nothing here is reachable from the partner API. `PUBLIC_QUERIES` in
--     workers/src/lib/db.js is an allow-list, so a new query is private until
--     somebody deliberately publishes it, and `nopii.js` catches `note` and
--     `contact` by key regardless.
--
-- What no schema can do is make the words kind. `contacts.notes` already
-- carries the warning that it is disclosable to the subject on a subject
-- access request; everything here is too. Write as though the person will read
-- it, because one day they are entitled to.
-- ============================================================================

CREATE TABLE life_events (
  id            TEXT PRIMARY KEY,
  contact_id    TEXT NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
  -- Denormalized so every tenant-owned table can be scoped without a join,
  -- the convention used by `interactions`. Kept honest by the two triggers
  -- below rather than by the app layer remembering.
  partner_id    TEXT NOT NULL REFERENCES partners(id)  ON DELETE CASCADE,

  -- A CHECK list rather than free text, because these drive an icon and a
  -- sort, and because "Job change"/"job change"/"New job" typed on three
  -- different days are three categories to a database and one to a human.
  --
  -- 'other' is deliberate and load-bearing: the list cannot be complete, and
  -- without an escape hatch somebody files an engagement under 'marriage'
  -- and the data lies. The note carries what the kind cannot.
  kind          TEXT NOT NULL CHECK (kind IN (
                  'birth','marriage','bereavement','illness','job_change',
                  'move','baptism','graduation','retirement','other')),

  -- NULLABLE, on purpose. "She is expecting" is worth writing down months
  -- before there is a date, and a table that demands one would either lose
  -- the note or invite a guessed date that later reads as fact.
  occurred_on   TEXT,

  note          TEXT,

  -- A birthday comes round again; a bereavement does not. The distinction is
  -- here rather than inferred from `kind` because it is not a property of the
  -- kind — a wedding anniversary and a wedding are both 'marriage', and only
  -- one of them is worth remembering every year.
  --
  -- (An event cannot recur without a date to recur ON — enforced by the
  -- table-level CHECK at the foot of this definition, which is where SQLite
  -- requires a constraint naming more than one column to live.)
  recurs        INTEGER NOT NULL DEFAULT 0 CHECK (recurs IN (0,1)),

  -- ATTRIBUTION on a row whose real content is something else, so SET NULL —
  -- the rule 0010 settled for `interactions.logged_by` and four others.
  -- Losing who wrote it is a shame; losing what happened to the person is
  -- data loss.
  logged_by     TEXT REFERENCES users(id) ON DELETE SET NULL,

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,

  -- A recurring event needs a date to recur on. A table-level constraint
  -- because it reads two columns, and SQLite accepts those only after every
  -- column has been declared — putting it beside `recurs`, where it belongs
  -- logically, is a syntax error near whatever follows it.
  CHECK (recurs = 0 OR occurred_on IS NOT NULL)
);

-- Newest first, per person — the order the dialog reads them in.
CREATE INDEX idx_life_events_contact ON life_events(contact_id, occurred_on DESC);
-- Every recurring date for one partner, for whatever comes to ask "whose
-- birthday is next week". Partial, because recurring rows are the minority
-- and the question is never asked about the others.
CREATE INDEX idx_life_events_recurring ON life_events(partner_id, occurred_on)
  WHERE recurs = 1;

-- An event must belong to the same partner as its contact — the guarantee
-- `trg_interactions_partner_match` gives conversations, given to this.
--
-- ON UPDATE AS WELL AS INSERT, which `interactions` does NOT have. That is
-- not a copy of an oversight: an interaction is written once and left alone,
-- whereas a life event is explicitly editable — "expecting" becomes a birth
-- date, a typo gets fixed — so there is a real UPDATE path here for a bug to
-- reach through, and the INSERT guard alone would not cover it.
CREATE TRIGGER trg_life_events_partner_match
BEFORE INSERT ON life_events
FOR EACH ROW WHEN NEW.partner_id <> (SELECT partner_id FROM contacts WHERE id = NEW.contact_id)
BEGIN
  SELECT RAISE(ABORT, 'life_event.partner_id must match contact.partner_id');
END;

CREATE TRIGGER trg_life_events_partner_match_update
BEFORE UPDATE ON life_events
FOR EACH ROW WHEN NEW.partner_id <> (SELECT partner_id FROM contacts WHERE id = NEW.contact_id)
BEGIN
  SELECT RAISE(ABORT, 'life_event.partner_id must match contact.partner_id');
END;
