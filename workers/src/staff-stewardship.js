/**
 * staff-stewardship.js — one supporter's record: contacts and notes in one place
 *
 *   GET    /api/staff-stewardship?contact=…                  their whole record
 *   POST   /api/staff-stewardship  {person:…}                add or edit a person
 *   POST   /api/staff-stewardship  {contact_id, event:…}     add or edit a life event
 *   POST   /api/staff-stewardship  {contact_id, interaction:…} log or correct a contact
 *   DELETE ?contact=…&event=…                                remove a life event
 *   DELETE ?contact=…&interaction=…                          remove a logged contact
 *   DELETE ?contact=…&confirm=DELETE                         remove the person, and
 *                                                            everything about them
 *
 * WHAT THIS PAGE IS. Chase's words: "a digital version of keeping track of
 * people in one place. Like Contacts and Notes in 1 place." A personal address
 * book, not a CRM and not a mailing list — which is why there is no consent
 * here (that lives with the mailing lists, in `subscribers`) and why
 * everything on it can be corrected by the person who wrote it.
 *
 * WHO CAN REACH IT. Nobody outside the console. This is not the partner API —
 * that one is for public websites, runs an allow-list of queries, and refuses
 * to start if any of them names `contacts`, `interactions` or `life_events`
 * (PRIVATE_TABLES in lib/db.js). A request here must carry a Cloudflare Access
 * sign-in, which this file verifies itself rather than trusting the edge, and
 * then only reaches the partner that sign-in is granted. "/api/" in the path
 * is only where the console's pages talk to the database; a browser cannot
 * read a database any other way.
 *
 * ONE PERSON AT A TIME. The list (/api/staff-snapshot) carries no email and no
 * phone. This endpoint answers for ONE person by id, and it is the only place
 * a supporter's contact details cross the wire. Every GET is written to the
 * audit log, because it is the only GET that returns somebody's address.
 *
 * TWO KINDS OF THING ABOUT A PERSON, KEPT APART
 * ---------------------------------------------------------------------------
 * A LIFE EVENT is a fact about them — a birth, a bereavement, a move. A
 * LOGGED CONTACT is a touch that happened. Both are editable. They are kept in
 * separate tables because only the second moves `last_personal_contact`: a
 * bereavement is a reason to call, not a call. See 0034_life_events.sql.
 *
 * Only contacts a PERSON logged can be edited or removed. Newsletter entries
 * are written by the mailing run and record what was actually sent; the SQL
 * refuses them (`source = 'manual'`) rather than trusting the console not to
 * offer them.
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

const MAX_FIELD = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a person. Returns `{ value }` or `{ error }`.
 *
 * Only a name is required — first OR last, because some people are known by
 * one. Everything else is optional: an address book entry for somebody met
 * once at a conference may be a name and a city and nothing more.
 */
export function cleanPerson(body) {
  const field = (k) => {
    const v = body[k] == null ? "" : String(body[k]).trim();
    return v || null;
  };
  const value = {
    first_name: field("first_name"), last_name: field("last_name"),
    email: field("email"), phone: field("phone"),
    address_1: field("address_1"), address_2: field("address_2"),
    city: field("city"), region: field("region"),
    postal_code: field("postal_code"), country: field("country"),
    notes: field("notes"),
  };

  if (!value.first_name && !value.last_name) return { error: "A person needs a name." };
  for (const [k, v] of Object.entries(value)) {
    if (k === "notes") continue;
    if (v && v.length > MAX_FIELD) return { error: `${k.replace("_", " ")} is too long.` };
  }
  if (value.notes && value.notes.length > MAX_NOTE * 5) {
    return { error: `The notes are longer than ${MAX_NOTE * 5} characters.` };
  }
  if (value.email && !EMAIL_RE.test(value.email)) {
    return { error: "That email address does not look right." };
  }
  /* The column holds a two-letter country code (0001: ISO-3166-1 alpha-2).
     Uppercased so "hr" and "HR" are one country, not two. */
  if (value.country) {
    value.country = value.country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(value.country)) {
      return { error: "Country is a two-letter code, like US or HR." };
    }
  }
  return { value };
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
    person,
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
    const logged_by = me.user_id || null;

    const you = {
      email: actor.email,
      name: me.user_name || null,
      roles: String(me.roles || "staff").split(",").filter(Boolean),
    };
    const note = (action, entity, entity_id, detail = null) => audit(db, {
      email: actor.email, partner_id, action, entity, entity_id, detail,
    });
    /* The whole refreshed record, after any write. The dialog re-renders from
       this rather than patching its own copy. */
    const answer = async (contact_id, extra = {}) => {
      const detail = await detailFor(db, partner_id, contact_id);
      if (!detail) return json({ error: "No such person.", you }, 404);
      return json(withActing({ you, ...extra, ...detail }, actor));
    };

    if (request.method === "GET") {
      const contact_id = url.searchParams.get("contact");
      if (!contact_id) return json({ error: "No person named.", you }, 400);

      const detail = await detailFor(db, partner_id, contact_id);
      /* The same answer for "no such person" and "not yours". A distinct 403
         would confirm that an id exists in somebody else's list. */
      if (!detail) return json({ error: "No such person.", you }, 404);

      await note("stewardship.open", "contact", contact_id,
        actor.acting ? { acting_as: actor.acting.name } : null);
      return json(withActing({ you, ...detail }, actor));
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      /* ---- a person: the one write that may CREATE the record it names ---- */
      if (body.person) {
        const { value, error } = cleanPerson(body.person);
        if (error) return json({ error, you }, 400);

        const given = body.person.id ? String(body.person.id) : null;
        const exists = given &&
          await db.queryOne("contact_detail", { contact_id: given, partner_id });
        /* An id that is not this partner's is treated as a new person, never
           as an edit — contact_upsert's WHERE would refuse to touch the other
           partner's row anyway, and this keeps it from even trying. */
        const id = exists ? given : newId("c_");

        await db.query("contact_upsert", { id, partner_id, now, ...value });
        /* An id and nothing else. The audit log is append-only and survives
           the person's deletion; their name must not. */
        await note(exists ? "stewardship.person.edit" : "stewardship.person.add",
          "contact", id);
        return answer(id, { id, created: !exists });
      }

      /* ---- everything else is about a person who must already be this
              partner's, proved BEFORE anything is written ---- */
      const contact_id = String(body.contact_id || "");
      const person = await db.queryOne("contact_detail", { contact_id, partner_id });
      if (!person) return json({ error: "No such person.", you }, 404);

      if (body.interaction) {
        const { value, error } = cleanInteraction(body.interaction);
        if (error) return json({ error, you }, 400);

        const given = body.interaction.id ? String(body.interaction.id) : null;
        if (given) {
          const own = (await db.query("contact_timeline", { contact_id, partner_id }))
            .find((i) => i.id === given);
          if (!own) return json({ error: "That contact is not on this person's record.", you }, 404);
          if (own.source !== "manual") {
            return json({ error: "Newsletter entries record what was sent, and cannot be edited.", you }, 400);
          }
          await db.query("interaction_update", { id: given, contact_id, partner_id, ...value });
          await note("stewardship.interaction.edit", "interaction", given,
            { contact_id, type: value.type, is_personal: !!value.is_personal });
          return answer(contact_id, { id: given });
        }

        const id = newId("in_");
        await db.query("interaction_add", { id, contact_id, partner_id, logged_by, now, ...value });
        await note("stewardship.interaction", "interaction", id,
          { contact_id, type: value.type, is_personal: !!value.is_personal });
        return answer(contact_id, { logged: id });
      }

      if (body.event) {
        const { value, error } = cleanLifeEvent(body.event);
        if (error) return json({ error, you }, 400);

        const existing = await db.query("life_events_for_contact", { contact_id, partner_id });
        const isNew = !body.event.id || !existing.some((e) => e.id === body.event.id);
        const id = isNew ? newId("le_") : String(body.event.id);

        await db.query("life_event_upsert", { id, contact_id, partner_id, logged_by, now, ...value });
        /* The KIND, never the note. Copying the words would put a second,
           undeletable copy of a bereavement in an append-only table that
           deleting the person cannot reach. */
        await note(isNew ? "stewardship.event.add" : "stewardship.event.edit",
          "life_event", id, { contact_id, kind: value.kind });
        return answer(contact_id, { id, created: isNew });
      }

      return json({ error: "Nothing to save.", you }, 400);
    }

    if (request.method === "DELETE") {
      const contact_id = url.searchParams.get("contact");
      if (!contact_id) return json({ error: "No person named.", you }, 400);
      const person = await db.queryOne("contact_detail", { contact_id, partner_id });
      if (!person) return json({ error: "No such person.", you }, 404);

      const event = url.searchParams.get("event");
      if (event) {
        await db.query("life_event_delete", { id: event, partner_id });
        await note("stewardship.event.delete", "life_event", event, { contact_id });
        return answer(contact_id, { deleted: event });
      }

      const interaction = url.searchParams.get("interaction");
      if (interaction) {
        await db.query("interaction_delete", { id: interaction, contact_id, partner_id });
        await note("stewardship.interaction.delete", "interaction", interaction, { contact_id });
        return answer(contact_id, { deleted: interaction });
      }

      /* THE PERSON. Checked here and not only in the dialog: a dialog is a
         suggestion, and this is the one request on the page that cannot be
         undone. Their contacts and life events go with them (ON DELETE
         CASCADE), in the same statement. */
      if (url.searchParams.get("confirm") !== "DELETE") {
        return json({ error: "Removing a person needs confirm=DELETE.", you }, 400);
      }
      await db.query("contact_delete", { id: contact_id, partner_id });
      await note("stewardship.person.delete", "contact", contact_id);
      return json(withActing({ you, deleted: contact_id }, actor));
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
