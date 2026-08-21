/**
 * staff-mailing — a partner's own mailing lists
 *
 * ISOLATION IS THE FEATURE, so it is worth saying exactly where it lives:
 * every query in db/queries.sql under MAILING takes :partner_id, including the
 * ones a list id alone would satisfy. This file resolves that partner from the
 * signed-in account and never from anything the caller sends. There is no
 * request shape that reaches another partner's subscribers, because the id is
 * not an input.
 *
 * THE ORGANISATION'S OWN LISTS have partner_id NULL and belong to nobody's
 * partner account. Reaching them needs `admin` or `communications`, and that is
 * asked for explicitly with ?scope=organisation rather than inferred — a
 * request that does not say so gets the caller's own lists, which is the safe
 * reading of an ambiguous one.
 *
 * WHY communications EXISTS SEPARATELY FROM admin: mailing everyone the
 * organisation has ever collected is a different act from managing accounts,
 * and one person may reasonably be trusted with either alone.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";
import { sendMail, listConfirmEmail } from "./lib/mail.js";

const MAX = { name: 120, slug: 60, desc: 400, from_name: 80, email: 200 };
const PAGE = 100;

const newId = (p) => p + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

/* A slug is part of a public unsubscribe URL, so it is kept to the characters
   that survive being pasted into an email client and back out again. */
export function slugify(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, MAX.slug) || null;
}

/* Deliberately loose. A closed list of valid addresses is how a real address
   gets refused; this rejects the shapes that cannot be an address at all and
   leaves the rest to the confirmation email, which is the only real test. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  if (typeof v !== "string") return null;
  const out = v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
  return out === "" ? null : out;
}

/** Resolve who is asking and which partner's lists they may touch. */
async function scopeFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) return { denied: json({ error: "This address is not an active account." }, 403) };

  const roles = String(me.roles || "").split(",").filter(Boolean);
  const maySendAsOrg = roles.includes("admin") || roles.includes("communications");

  const url = new URL(request.url);
  if (url.searchParams.get("scope") === "organisation") {
    if (!maySendAsOrg) {
      return { denied: json({
        error: "Thauma's own lists need the administrator or communications role.",
      }, 403) };
    }
    /* NULL, which is what the schema means by "the organisation". */
    return { db, user, me, actor, partnerId: null, isOrg: true, maySendAsOrg };
  }

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet, so it has no mailing lists.",
    }, 403) };
  }
  return { db, user, me, actor, partnerId: partners[0].id, partner: partners[0],
           isOrg: false, maySendAsOrg };
}

/** Validate a list definition. Returns `{ value }` or `{ error }`. */
export function cleanList(body) {
  const name = clean(body.name, MAX.name);
  if (!name) return { error: "A list needs a name." };

  const slug = clean(body.slug, MAX.slug) || slugify(name);
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { error: `"${body.slug || name}" does not make a usable web address.` };
  }

  const from_name = clean(body.from_name, MAX.from_name);
  if (!from_name) return { error: "A list needs a sender name — who the email is from." };

  const from_email = clean(body.from_email, MAX.email);
  if (!from_email || !EMAIL_RE.test(from_email)) {
    return { error: "A list needs a sender address, and it must look like an address." };
  }

  const reply_to = clean(body.reply_to, MAX.email);
  if (reply_to && !EMAIL_RE.test(reply_to)) {
    return { error: "That reply-to address does not look like an address." };
  }

  return { value: {
    name, slug, from_name, from_email, reply_to,
    description: clean(body.description, MAX.desc),
    is_open: body.is_open ? 1 : 0,
    form_heading: clean(body.form_heading, 120),
    form_blurb: clean(body.form_blurb, 240),
    form_button: clean(body.form_button, 40),
    form_thanks_url: clean(body.form_thanks_url, 300),
  } };
}

export default {
  async fetch(request, env) {
    const s = await scopeFor(request, env);
    if (s.denied) return s.denied;

    const { db, partnerId, actor } = s;
    const now = new Date().toISOString();
    const url = new URL(request.url);
    const myRoles = String(s.me.roles || "").split(",").filter(Boolean);

    /* ------------------------------------------------------------ GET */
    if (request.method === "GET") {
      const listId = url.searchParams.get("list");

      if (listId) {
        const list = await db.queryOne("mailing_list_one", { id: listId, partner_id: partnerId });
        /* 404 rather than 403 for a list belonging to somebody else. Telling
           the caller it EXISTS but is not theirs is itself a leak. */
        if (!list) return json({ error: "No such list." }, 404);

        const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10) || 0);
        const subscribers = await db.query("subscribers_for_list", {
          list_id: listId, partner_id: partnerId, limit: PAGE, offset: page * PAGE,
        });
        return json(withActing({
          you: { email: actor.email, roles: myRoles },
          scope: s.isOrg ? "organisation" : "partner",
          list, subscribers, page, page_size: PAGE,
        }, actor));
      }

      const [lists, tags] = await Promise.all([
        db.query("mailing_lists_for_partner", { partner_id: partnerId }),
        db.query("mailing_tags_for_partner", { partner_id: partnerId }),
      ]);

      return json(withActing({
        you: { email: actor.email, roles: myRoles },
        scope: s.isOrg ? "organisation" : "partner",
        /* So the console can offer the switch only to people who have it,
           rather than showing a control that answers 403. */
        may_send_as_organisation: s.maySendAsOrg,
        /* The SLUG as well as the name: the sign-up snippet's URL is built
           from the slug, and the display name is not it. */
        partner: s.partner
          ? { id: s.partner.id, slug: s.partner.slug, display_name: s.partner.display_name }
          : null,
        lists, tags,
      }, actor));
    }

    /* ----------------------------------------------------------- POST */
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "The request body was not valid JSON." }, 400);

      if (body.action === "tag") {
        const name = clean(body.name, 60);
        if (!name) return json({ error: "A tag needs a name." }, 400);
        if (body.id) {
          await db.query("mailing_tag_rename", { id: body.id, partner_id: partnerId, name });
          return json({ ok: true, id: body.id, name });
        }
        const id = newId("tag");
        await db.query("mailing_tag_create", {
          id, partner_id: partnerId, name, sort_order: 0, now,
        });
        return json({ ok: true, id, name });
      }

      /* ADDING SOMEBODY BY HAND STILL CONFIRMS.
         The first version skipped it, reasoning that somebody who asked in
         person has already consented. That missed the second job a
         confirmation does: it is the only proof the ADDRESS WORKS. Skipping it
         means finding the typo weeks later when a send bounces and nobody
         remembers what was typed. `source` records how they arrived. */
      if (body.action === "add-subscriber") {
        const email = clean(body.email, MAX.email);
        if (!email || !EMAIL_RE.test(email)) {
          return json({ error: "That does not look like an email address." }, 400);
        }
        const listId = String(body.list_id || "");
        if (!listId) return json({ error: "list_id is required" }, 400);

        const list = await db.queryOne("mailing_list_one", { id: listId, partner_id: partnerId });
        if (!list) return json({ error: "No such list." }, 404);

        /* 32 random bytes. It is the ONLY thing identifying the person who
           clicks the link, so it has to be unguessable rather than merely
           unique. */
        const token = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((b) => b.toString(16).padStart(2, "0")).join("");

        try {
          await db.query("subscriber_add", {
            id: newId("sub"), list_id: listId, partner_id: partnerId,
            email, name: clean(body.name, MAX.name), token,
            source: clean(body.source, 60) || "added by hand", now,
          });
        } catch (e) {
          /* The unique index doing its job. Said plainly rather than as a
             constraint name, because "already on this list" is the answer. */
          if (/UNIQUE/i.test(e.message || "")) {
            return json({ error: `${email} is already on this list.` }, 409);
          }
          throw e;
        }

        const origin = new URL(request.url).origin;
        const mail = listConfirmEmail({
          name: clean(body.name, MAX.name),
          listName: list.name,
          fromName: list.from_name,
          confirmUrl: `${origin}/confirm?t=${token}`,
        });
        const sent = await sendMail(env, {
          to: email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          /* From the LIST's address, not the system's. A confirmation arriving
             from somewhere the person has never heard of is the one most
             likely to be ignored. */
          from: `${list.from_name} <${list.from_email}>`,
          replyTo: list.reply_to || undefined,
        });

        /* THE ROW STAYS EITHER WAY, and the answer says which happened. They
           are `pending`, which is true whether or not the email left — and a
           silent failure here would leave somebody waiting for a message
           nobody knows was never sent. Re-adding is refused as a duplicate, so
           the way to retry is to delete and add again; the message says so. */
        return json({
          ok: true, email, status: "pending",
          sent: sent.ok === true,
          sendError: sent.ok ? undefined : sent.error,
        });
      }

      if (body.action === "subscriber") {
        const status = String(body.status || "");
        /* `pending` is deliberately absent. Moving somebody BACK to unconfirmed
           would claim they never agreed, which is not a thing a console should
           be able to assert on their behalf. */
        if (!["subscribed", "unsubscribed", "bounced"].includes(status)) {
          return json({ error: `${status || "That"} is not a status this can set.` }, 400);
        }
        await db.query("subscriber_set_status", {
          id: String(body.id || ""), partner_id: partnerId, status, now,
        });
        return json({ ok: true });
      }

      const { value, error } = cleanList(body);
      if (error) return json({ error }, 400);

      const id = clean(body.id, 60) || newId("ml");
      const taken = await db.queryOne("mailing_list_slug_taken", {
        partner_id: partnerId, slug: value.slug, id,
      });
      if (taken) {
        return json({ error: `Another list already uses the address "${value.slug}".` }, 409);
      }

      await db.query("mailing_list_upsert", { id, partner_id: partnerId, ...value, now });
      const saved = await db.queryOne("mailing_list_one", { id, partner_id: partnerId });
      /* Absent after a write means the WHERE partner_id guard refused it — an
         id that belongs to somebody else. Reported as not-found for the same
         reason the GET does. */
      if (!saved) return json({ error: "No such list." }, 404);
      return json({ ok: true, list: saved });
    }

    /* --------------------------------------------------------- DELETE */
    if (request.method === "DELETE") {
      const body = await readJson(request);
      if (!body || !body.id) return json({ error: "id is required" }, 400);

      if (body.what === "subscriber") {
        await db.query("subscriber_delete", { id: body.id, partner_id: partnerId });
        return json({ ok: true, removed: body.id });
      }
      if (body.what === "tag") {
        await db.query("mailing_tag_delete", { id: body.id, partner_id: partnerId });
        return json({ ok: true, removed: body.id });
      }

      await db.query("mailing_list_archive", { id: body.id, partner_id: partnerId, now });
      return json({ ok: true, archived: body.id });
    }

    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, DELETE" });
  },
};
