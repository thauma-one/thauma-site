/**
 * staff-stewardship.js — one supporter, opened from their row
 *
 *   GET    /api/staff-stewardship?contact=…        quick facts + life events
 *   POST   /api/staff-stewardship  {event:…}       create or edit a life event
 *   POST   /api/staff-stewardship  {interaction:…} log a call, visit, note
 *   DELETE /api/staff-stewardship?event=…          remove a life event
 *
 * WHAT THIS ENDPOINT IS FOR, AND WHY IT IS NOT PART OF THE SNAPSHOT
 * ---------------------------------------------------------------------------
 * /api/staff-snapshot returns the whole stewardship LIST, and the query behind
 * it deliberately carries no email and no phone — its own comment explains
 * that shipping the partner's address book on every page load to render a
 * column of dates is not minimisation, whatever gate sits in front of it.
 *
 * This endpoint is the other half of that decision. It answers for ONE person,
 * named by id, and it is the only place a supporter's contact details cross
 * the wire. Opening a dialog costs one person's details; nothing costs the
 * list.
 *
 * TWO KINDS OF WRITE, AND THEY ARE DIFFERENT KINDS OF THING
 * ---------------------------------------------------------------------------
 * A LIFE EVENT is a fact about a person — a birth, a bereavement, a move. It
 * is editable, because what is known changes: "expecting" acquires a date, a
 * name is misspelled, a note is written badly the first time.
 *
 * An INTERACTION is a touch that happened. It is appended and never edited,
 * because a contact log whose past can be rewritten is not a log. There is no
 * PATCH here and no interaction delete, deliberately. A mistake is corrected
 * by recording what actually happened — which is what anybody would do on
 * paper.
 *
 * The two must not be confused, and the database will not let them be: a life
 * event cannot move `last_personal_contact`, because `contact_touch` does not
 * know the table exists. See db/migrations/0034_life_events.sql.
 *
 * EVERY READ HERE IS AUDITED
 * ---------------------------------------------------------------------------
 * db/README.md: "An `admin` is not automatically entitled to read a partner's
 * contacts… every such read should write to audit_log." This is the screen
 * that makes that concrete, so a GET writes a row naming who opened whose
 * record. It is the only GET in the console that does, and the reason is that
 * it is the only GET that returns somebody's address and phone number.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";

/* Mirrors the CHECK constraint in 0034. Duplicated on purpose: the database is
   the authority, and this exists so a bad value gets a sentence instead of a
   constraint violation the console cannot render. */
const KINDS = ["birth", "marriage", "bereavement", "illness", "job_change",
               "move", "baptism", "graduation", "retirement", "other"];

/* Mirrors the CHECK on `interactions` from 0001. 'newsletter' is absent: bulk
   sends are written by the mailing run, not by a person at this screen, and
   offering it here would invite somebody to log one by hand and then wonder
   why it does not count as personal contact. */
const TYPES = ["call", "text", "email", "visit", "meal", "video_call",
               "handwritten", "postal_mail", "event", "other"];

const CHANNELS = ["digital", "physical", "in_person"];

const MAX_NOTE = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function newId(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

async function partnerFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) return { denied: json({ error: "This address is not an active account." }, 403) };

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet, so there are no " +
             "supporters to look after. Roles on the People page are org-wide " +
             "and grant nothing here; the partner itself is granted separately, " +
             "on that person's row.",
    }, 403) };
  }
  return { db, user, me, partner: partners[0], actor };
}

/** Append to the record. A failed note must not fail the action it describes. */
async function audit(db, { email, action, entity, entity_id, partner_id, detail = null }) {
  try {
    await db.query("audit_write", {
      id: newId("a_"),
      now: new Date().toISOString(),
      user_id: email,
      partner_id,
      action, entity, entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/**
 * Validate one life event. Returns `{ value }` or `{ error }`.
 *
 * NO DATE IS A VALID ANSWER. "She is expecting" is worth writing down months
 * before there is a date, and demanding one would either lose the note or
 * invite a guess that later reads as fact.
 */
export function cleanLifeEvent(body) {
  const kind = String(body.kind || "");
  if (!KINDS.includes(kind)) {
    return { error: `Kind must be one of ${KINDS.join(", ")}.` };
  }

  let occurred_on = null;
  if (body.occurred_on != null && String(body.occurred_on).trim() !== "") {
    const d = String(body.occurred_on).trim();
    if (!DATE_RE.test(d)) return { error: "The date must look like 2026-09-21." };
    occurred_on = d;
  }

  const note = body.note == null ? null : String(body.note).trim() || null;
  if (note && note.length > MAX_NOTE) {
    return { error: `The note is longer than ${MAX_NOTE} characters.` };
  }

  const recurs = body.recurs ? 1 : 0;
  /* The table's own CHECK says the same. Refusing here means a sentence a
     person can act on rather than a constraint violation. */
  if (recurs && !occurred_on) {
    return { error: "Something that comes round every year needs a date to come round on." };
  }

  /* An event with neither a date nor a note is a category and nothing else —
     a row that says "bereavement" and cannot say whose or when. */
  if (!occurred_on && !note) {
    return { error: "Add a date or a note — otherwise there is nothing here to remember." };
  }

  return { value: { kind, occurred_on, note, recurs } };
}

/** Validate one logged interaction. */
export function cleanInteraction(body) {
  const type = String(body.type || "");
  if (!TYPES.includes(type)) {
    return { error: `Type must be one of ${TYPES.join(", ")}.` };
  }

  const channel = String(body.channel || "digital");
  if (!CHANNELS.includes(channel)) {
    return { error: `Channel must be one of ${CHANNELS.join(", ")}.` };
  }

  /* REQUIRED, unlike a life event's. An interaction with no date cannot be
     placed in the timeline and cannot move `last_personal_contact`, which is
     the entire reason for logging it. */
  const occurred_on = String(body.occurred_on || "").trim();
  if (!DATE_RE.test(occurred_on)) {
    return { error: "When did this happen? The date must look like 2026-09-21." };
  }

  const note = body.note == null ? null : String(body.note).trim() || null;
  if (note && note.length > MAX_NOTE) {
    return { error: `The note is longer than ${MAX_NOTE} characters.` };
  }

  /* PASSED, NOT DERIVED. Only the person who was there knows whether an email
     was a note to one friend or a forward to forty, and guessing from `type`
     would quietly decide the one number this page exists to report. */
  return { value: { type, channel, occurred_on, note, is_personal: body.is_personal ? 1 : 0 } };
}

/** Everything the dialog shows, for one person. */
async function detailFor(db, partner_id, contact_id) {
  const person = await db.queryOne("contact_detail", { contact_id, partner_id });
  if (!person) return null;

  const [events, timeline] = await Promise.all([
    db.query("life_events_for_contact", { contact_id, partner_id }),
    db.query("contact_timeline", { contact_id, partner_id }),
  ]);

  return {
    person: {
      ...person,
      newsletter_consent: !!person.newsletter_consent,
      postal_consent: !!person.postal_consent,
    },
    events: events.map((e) => ({ ...e, recurs: !!e.recurs })),
    timeline: timeline.map((i) => ({ ...i, is_personal: !!i.is_personal })),
  };
}

export default {
  async fetch(request, env) {
    const { db, user, me, partner, actor, denied } = await partnerFor(request, env);
    if (denied) return denied;

    await auditActingWrite(request, db, actor);

    const partner_id = partner.id;
    const url = new URL(request.url);
    const now = new Date().toISOString();

    const you = {
      email: actor.email,
      name: me.user_name || null,
      roles: String(me.roles || "staff").split(",").filter(Boolean),
    };

    if (request.method === "GET") {
      const contact_id = url.searchParams.get("contact");
      if (!contact_id) return json({ error: "No supporter named.", you }, 400);

      const detail = await detailFor(db, partner_id, contact_id);
      /* The same answer for "no such person" and "not yours". A distinct 403
         would confirm that an id exists in somebody else's list, which is a
         small leak but a free one to close. */
      if (!detail) return json({ error: "No such supporter.", you }, 404);

      /* The audited read. See the note at the top of this file. */
      await audit(db, {
        email: actor.email, partner_id,
        action: "stewardship.open", entity: "contact", entity_id: contact_id,
        detail: actor.acting ? { acting_as: actor.acting.name } : null,
      });

      return json(withActing({ you, ...detail }, actor));
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const contact_id = String(body.contact_id || "");
      /* Proves the supporter is this partner's BEFORE anything is written.
         Without it, the insert would be caught by the trigger in 0034 — which
         is the right backstop but the wrong error message. */
      const person = await db.queryOne("contact_detail", { contact_id, partner_id });
      if (!person) return json({ error: "No such supporter.", you }, 404);

      if (body.interaction) {
        const { value, error } = cleanInteraction(body.interaction);
        if (error) return json({ error, you }, 400);

        const id = newId("in_");
        await db.query("interaction_add", {
          id, contact_id, partner_id, logged_by: me.user_id || null, now, ...value,
        });
        await audit(db, {
          email: actor.email, partner_id,
          action: "stewardship.interaction", entity: "interaction", entity_id: id,
          detail: { contact_id, type: value.type, is_personal: !!value.is_personal },
        });

        return json(withActing({ you, logged: id, ...await detailFor(db, partner_id, contact_id) }, actor));
      }

      if (body.event) {
        const { value, error } = cleanLifeEvent(body.event);
        if (error) return json({ error, you }, 400);

        /* The id comes from us on a create so a retry cannot duplicate. On an
           edit it comes from the caller, and `life_event_upsert` carries
           partner_id in its UPDATE's WHERE — so an id belonging to another
           tenant updates nothing rather than rewriting their row. */
        const existing = await db.query("life_events_for_contact", { contact_id, partner_id });
        const isNew = !body.event.id || !existing.some((e) => e.id === body.event.id);
        const id = isNew ? newId("le_") : String(body.event.id);

        await db.query("life_event_upsert", {
          id, contact_id, partner_id, logged_by: me.user_id || null, now, ...value,
        });
        await audit(db, {
          email: actor.email, partner_id,
          action: isNew ? "stewardship.event.add" : "stewardship.event.edit",
          entity: "life_event", entity_id: id,
          /* The KIND, never the note. An audit row records that something was
             written about somebody; copying the words would put a second,
             undeletable copy of a bereavement in an append-only table that
             `DELETE FROM contacts` cannot reach. */
          detail: { contact_id, kind: value.kind },
        });

        return json(withActing({ you, id, created: isNew, ...await detailFor(db, partner_id, contact_id) }, actor));
      }

      return json({ error: "Nothing to save — expected an event or an interaction.", you }, 400);
    }

    if (request.method === "DELETE") {
      const id = url.searchParams.get("event");
      const contact_id = url.searchParams.get("contact");
      if (!id || !contact_id) return json({ error: "No event named.", you }, 400);

      await db.query("life_event_delete", { id, partner_id });
      await audit(db, {
        email: actor.email, partner_id,
        action: "stewardship.event.delete", entity: "life_event", entity_id: id,
        detail: { contact_id },
      });

      const detail = await detailFor(db, partner_id, contact_id);
      if (!detail) return json({ error: "No such supporter.", you }, 404);
      return json(withActing({ you, deleted: id, ...detail }, actor));
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
