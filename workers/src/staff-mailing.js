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
import { sanitise, render, toText, plainLine, tooBig, sizeOf } from "./lib/newsletter.js";
import { unsubscribeUrl } from "./lib/unsub.js";
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

/**
 * Validate a list definition. Returns `{ value }` or `{ error }`.
 *
 * `existingSlug` is the slug the list already has. THE SLUG IS NEVER EDITED
 * AND IS NOT SHOWN. It appears in exactly one place — the sign-up form's URL —
 * and is derived from the name the first time only. Renaming a list therefore
 * does NOT move its form, which is the behaviour that matters: the snippet is
 * pasted onto somebody else's website and nobody rebuilds that page because a
 * list got a better name.
 *
 * An earlier version put this on screen as "Web address" and locked it once a
 * list had subscribers, on the stated grounds that changing it would break
 * unsubscribe links. That was wrong — unsubscribing is token-based and does not
 * involve the slug at all — and the field confused everybody who saw it,
 * including me. Plumbing that only one URL depends on does not belong in a
 * form somebody has to understand.
 */
/**
 * @param allowed  Addresses this owner may send from. When supplied and
 *   non-empty the sender must be one of them — the field is a picker, and a
 *   picker enforced only in the browser is not enforced. When EMPTY it is not
 *   applied: an administrator who has not set up addresses yet must not find
 *   every existing list unsaveable, and lists created before this existed
 *   still hold addresses that were valid when they were typed.
 */
/* ------------------------------------------------------- THE COMPOSER ----
 * Writing, a test send, and the real one.
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE DESIGN. A send is the one thing in this
 * system that cannot be undone, corrected, or apologised for quietly — once a
 * message is with Resend it is on its way to real people. So:
 *
 *   1. Everything that can be refused is refused BEFORE anything is sent:
 *      no subject, no body, no sender, no recipients, a list that is not
 *      yours, a mailing already sent.
 *   2. The draft is flipped to 'sending' by an UPDATE that names its old
 *      status. Two requests arriving together both pass an if-statement; only
 *      one can win that UPDATE. That is what stops a double send.
 *   3. Recipients are written down before the first message leaves, so a
 *      crash mid-send leaves a record of who was reached.
 *   4. Each message carries its own unsubscribe link. There is no batch send
 *      here for that reason — a shared link would unsubscribe whoever clicked
 *      it from somebody else's row.
 */

/* Drafts come back with their files. Only drafts: a sent mailing cannot be
   reopened for editing, so loading its attachments would be reading rows
   nothing will use. */
async function withAttachments(db, listId, partnerId) {
  const rows = await db.query("mailings_for_list",
    { list_id: listId, partner_id: partnerId });
  for (const m of rows) {
    if (m.status !== "draft") continue;
    m.attachments = await db.query("mailing_attachments_for", { mailing_id: m.id });
  }
  return rows;
}

/** Everything a message needs, or the reason it cannot go. */
async function buildMailing(db, env, { mailing, list, origin }) {
  const subject = plainLine(mailing.subject, 200);
  if (!subject) return { error: "A mailing needs a subject." };

  const html = String(mailing.body_html || "").trim();
  if (!html) return { error: "There is nothing written yet." };
  if (!list.from_email) return { error: "This list has no sender address." };

  /* CHECKED BEFORE ANYTHING IS SENT, not per message. Unsubscribe links are
     signed, and a deploy with no signing secret cannot sign them — which would
     produce a newsletter whose only way out does not work, discovered by the
     people who tried to use it. Better to refuse the whole send. */
  try { await unsubscribeUrl(env, origin, "probe"); }
  catch (e) { return { error: String(e.message || e) }; }

  const preheader = plainLine(mailing.preheader, 160);

  /* MEASURED, NOT ESTIMATED. Gmail cuts a message off at about 102KB and shows
     "[Message clipped]" — and because the cut can land mid-tag, everything
     after it can fail to render at all. Checked on the FULL rendered email
     rather than on what was typed, because the shell, the inline styles and
     the Outlook block all count toward the limit. */
  const sample = render(html, {
    subject, preheader, fromName: list.from_name, listName: list.name,
    unsubscribeUrl: `${origin}/unsubscribe?s=x&t=` + "0".repeat(32),
    archiveUrl: list.archive_public ? `${origin}/archive/x/y/z` : null,
  });
  const big = tooBig(sample);
  if (big) return { error: big };

  return { value: { subject, html, preheader,
                    text: mailing.body_text || toText(html),
                    bytes: sizeOf(sample) } };
}

/* R2 objects to what Resend wants: base64, once per send rather than once per
   recipient. Read up front and reused for every message — a hundred
   subscribers must not mean a hundred reads of the same PDF. */
async function loadAttachments(env, rows) {
  const out = [];
  for (const row of rows || []) {
    const obj = await env.MEDIA.get(row.object_key);
    if (!obj) continue;                       // deleted from the bucket
    const bytes = new Uint8Array(await obj.arrayBuffer());
    /* Chunked, because String.fromCharCode(...arr) on a two-megabyte array
       blows the call-stack limit — a failure that only appears once somebody
       attaches something big. */
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    out.push({ filename: row.filename, content: btoa(binary) });
  }
  return out;
}

/** One message, addressed to one person. */
async function messageFor(env, { built, list, sub, origin, theme, archiveUrl, attachments }) {
  const unsubscribe = await unsubscribeUrl(env, origin, sub.id);
  const body = render(built.html, {
    subject: built.subject,
    preheader: built.preheader,
    fromName: list.from_name,
    listName: list.name,
    accent: theme && theme.accent,
    mode: theme && theme.mode,
    unsubscribeUrl: unsubscribe,
    archiveUrl,
  });
  return {
    to: sub.email,
    subject: built.subject,
    html: body,
    text: (built.text || "") + "\n\n—\n" + list.name +
          "\nUnsubscribe: " + unsubscribe,
    from: `${list.from_name} <${list.from_email}>`,
    replyTo: list.reply_to || undefined,
    /* THE HEADER GMAIL AND OUTLOOK ACTUALLY READ. Their one-click unsubscribe
       button uses this, and a reader who finds it is a reader who did NOT
       press "report spam" — which is the outcome that damages the domain for
       everybody else on it. */
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    attachments: attachments && attachments.length ? attachments : undefined,
  };
}

export function cleanList(body, existingSlug, allowed) {
  const name = clean(body.name, MAX.name);
  if (!name) return { error: "A list needs a name." };

  const slug = existingSlug || slugify(name);
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { error: `"${name}" has no letters or numbers in it, so there is no address to build.` };
  }

  const from_name = clean(body.from_name, MAX.from_name);
  if (!from_name) return { error: "A list needs a sender name — who the email is from." };

  const from_email = clean(body.from_email, MAX.email);
  if (!from_email || !EMAIL_RE.test(from_email)) {
    return { error: "A list needs a sender address, and it must look like an address." };
  }
  if (allowed && allowed.length &&
      !allowed.some((a) => a.toLowerCase() === from_email.toLowerCase())) {
    return { error: `${from_email} is not one of the addresses set up for you. ` +
                    `An address at a domain nobody verified sends nothing.` };
  }

  const reply_to = clean(body.reply_to, MAX.email);
  if (reply_to && !EMAIL_RE.test(reply_to)) {
    return { error: "That reply-to address does not look like an address." };
  }

  return { value: {
    name, slug, from_name, from_email, reply_to,
    description: clean(body.description, MAX.desc),
    is_open: body.is_open ? 1 : 0,
    /* Whether what is SENT to this list becomes readable on the web. On the
       list rather than on each mailing, because newsletters are public and
       prayer updates are not — a property of the list, not a decision to
       remake every time somebody writes. Per-mailing would mean one forgetful
       moment publishes a prayer request naming somebody. */
    archive_public: body.archive_public ? 1 : 0,
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

        /* Passed straight through as BOUND VALUES. The sort is decided by a
           CASE inside the query rather than by splicing a column name, so an
           unrecognised one falls through to newest-first instead of being an
           error — or a hole.

           ⚠ `|| ""` IS LOAD-BEARING. clean() returns NULL for an absent value,
           and the query asks `:status = ''` to mean "no filter". In SQL
           `NULL = ''` is not FALSE, it is NULL — so the whole OR collapses to
           NULL, every row fails the test, and the list comes back EMPTY while
           the counts above it still show the right totals. That is exactly how
           it looked: three subscribed, three unconfirmed, and no rows. */
        const sort = clean(url.searchParams.get("sort"), 20) || "";
        const status = clean(url.searchParams.get("status"), 20) || "";
        const q = clean(url.searchParams.get("q"), 120) || "";
        /* The wildcards belong to the SEARCH, not to the person typing. Left
           to them, a name containing % or _ would quietly match half the list
           — so those two characters are escaped and the wildcards are added
           here, where they are meant. */
        const like = q ? "%" + q.replace(/[%_]/g, "\\$&") + "%" : "";
        const args = { list_id: listId, partner_id: partnerId, sort, status, q, like };

        const [subscribers, total] = await Promise.all([
          db.query("subscribers_for_list", { ...args, limit: PAGE, offset: page * PAGE }),
          db.queryOne("subscribers_for_list_count", args),
        ]);
        return json(withActing({
          you: { email: actor.email, roles: myRoles },
          scope: s.isOrg ? "organisation" : "partner",
          list, subscribers, page, page_size: PAGE,
          /* So the console can say "1–100 of 340" rather than leaving somebody
             to work out whether there is another page by trying. */
          total: total ? total.n : subscribers.length,
          sort, status, q,
        }, actor));
      }

      /* The composer's list of drafts and sent mailings, for ONE list — the
         one being looked at. Fetching every list's history on every page load
         would grow without limit and is read on one screen. */
      const forList = clean(url.searchParams.get("mailings"), 60);

      /* HOW HEAVY THE EMAIL IS, measured on the REAL rendered message rather
         than on what was typed — the shell, the inline styles and the Outlook
         block all count toward Gmail's limit, and the body alone is a fraction
         of the total.

         This endpoint used to return the rendered HTML as well, for a live
         preview beside the editor. The preview is gone: a browser is not a
         mail client, so it could only ever be a layout check, while the test
         send shows the actual message in an actual inbox. The measurement had
         no such substitute, so it stayed. */
      const previewId = clean(url.searchParams.get("measure"), 60);
      if (previewId) {
        const m = await db.queryOne("mailing_one", { id: previewId, partner_id: partnerId });
        if (!m) return json({ error: "No such mailing." }, 404);
        const list = await db.queryOne("mailing_list_one",
          { id: m.list_id, partner_id: partnerId });
        const look = partnerId
          ? await db.queryOne("partner_settings", { partner_id: partnerId }) : null;
        const previewHtml = render(m.body_html || "", {
            subject: m.subject,
            preheader: m.preheader,
            fromName: list ? list.from_name : "",
            listName: list ? list.name : "",
            accent: look && look.embed_accent,
            mode: look && look.embed_theme,
            /* Included because it costs bytes, and bytes are the point of
               this call. Measuring a message without its footer would report a
               size the real one never has. */
            unsubscribeUrl: "https://example.invalid/unsubscribe",
            archiveUrl: list && list.archive_public ? "https://example.invalid/archive" : null,
        });
        /* The rendered HTML is measured and dropped, never returned. Sending
           six kilobytes back so the browser can read its length would be
           paying for the preview that no longer exists. */
        return json(withActing({
          bytes: sizeOf(previewHtml),
          tooBig: tooBig(previewHtml),
        }, actor));
      }

      const [lists, tags, senders, look] = await Promise.all([
        db.query("mailing_lists_for_partner", { partner_id: partnerId }),
        db.query("mailing_tags_for_partner", { partner_id: partnerId }),
        /* Scoped the same way everything else here is. Somebody choosing a
           sender must not be shown another partner's addresses, which would
           leak both the domain and what it is used for. */
        db.query("sender_addresses_for_partner", { partner_id: partnerId }),
        /* The ministry's colours. partners_for_user answers "what may this
           account reach", which is a different question and deliberately
           carries no presentation columns — so the palette is read from the
           partner row itself. Null for the organisation, which has no row. */
        partnerId ? db.queryOne("partner_settings", { partner_id: partnerId }) : null,
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
        /* The From field is a picker, not a text box: Resend verifies domains
           rather than addresses, so a typo leaves successfully, looks right in
           the log, and drops every reply into nothing. An administrator adds
           these on the Partners screen. */
        senders,
        mailings: forList ? await withAttachments(db, forList, partnerId) : [],

        /* THE SAME COLOURS EVERY OTHER WIDGET USES. Sent with the lists rather
           than fetched separately, because the sign-up preview draws on first
           paint and a second round trip would show it in the wrong colours
           first — which reads as the setting not having applied.

           The organisation has no partner row and therefore no palette, so the
           widget's own default stands. */
        /* Sent with everything else so the Contact tab paints on first open
           rather than after a second request — the tab is one click away and
           a blank form that fills in a moment later reads as broken. */
        contact: await db.queryOne("contact_form_for_partner", { partner_id: partnerId }),
        topics: await db.query("contact_topics_for_partner", { partner_id: partnerId }),

        embed: look
          ? { accent: look.embed_accent, accent2: look.embed_accent2,
              theme: look.embed_theme || "auto",
              /* CARRIED EVEN THOUGH THIS SCREEN NEVER CHANGES IT. The settings
                 endpoint takes the embed block whole, so the console has to
                 send `enabled` back unchanged when it saves a colour. Leaving
                 it out of this payload made the console send `false`, which
                 would have switched a ministry's published widgets off because
                 somebody picked a colour on the mailing page. */
              enabled: !!look.embed_enabled }
          : null,
        /* Changing them is admin-only, the same rule staff-settings enforces —
           they are shared by every widget this ministry publishes, so one
           person's preference would repaint everybody's pages. Sent so the
           console can show the controls read-only rather than offer a Save
           that answers 403. */
        may_theme: myRoles.includes("admin"),
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

      /* RESEND A CONFIRMATION. Asked for because the first one can fail in
         ways nobody can see from here — spam, a full mailbox, a typo in a
         domain that still resolves. A fresh token each time, so the newest
         email is always the working one and somebody holding two cannot pick
         the dead link and be told it is invalid. */
      if (body.action === "resend-confirmation") {
        const sub = await db.queryOne("subscriber_one", {
          id: String(body.id || ""), partner_id: partnerId,
        });
        if (!sub) return json({ error: "No such subscriber." }, 404);
        if (sub.status !== "pending") {
          return json({
            error: sub.status === "subscribed"
              ? `${sub.email} has already confirmed — there is nothing to resend.`
              : `${sub.email} is ${sub.status}. Only somebody waiting to confirm can be sent a link.`,
          }, 409);
        }

        const token = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        await db.query("subscriber_resend_confirm", {
          id: sub.id, partner_id: partnerId, token, now,
        });

        const origin = new URL(request.url).origin;
        const mail = listConfirmEmail({
          name: sub.name, listName: sub.list_name, fromName: sub.from_name,
          confirmUrl: `${origin}/confirm?t=${token}`,
        });
        const sent = await sendMail(env, {
          to: sub.email, subject: mail.subject, html: mail.html, text: mail.text,
          from: `${sub.from_name} <${sub.from_email}>`,
          replyTo: sub.reply_to || undefined,
        });

        return json({
          ok: sent.ok === true, email: sub.email,
          sent: sent.ok === true,
          sendError: sent.ok ? undefined : sent.error,
        }, sent.ok ? 200 : 502);
      }

      /* ---- the composer ---------------------------------------------- */

      if (body.action === "mailing-save") {
        const list = await db.queryOne("mailing_list_one",
          { id: clean(body.list_id, 60), partner_id: partnerId });
        if (!list) return json({ error: "No such list." }, 404);

        const subject = plainLine(body.subject, 200);
        if (!subject) return json({ error: "A mailing needs a subject." }, 400);

        /* LAYER B, AND IT LIVES HERE RATHER THAN IN THE BROWSER.
           The composer hands over the editor's rich HTML and stops. Turning
           that into what is actually sent happens on this side for three
           reasons, any one of which would be enough: HTML from a browser has
           to be sanitised regardless, the public archive re-renders from this
           same stored source, and each recipient's unsubscribe link has to be
           injected per message. Converting in the browser would mean three
           implementations of one thing, two of which nobody ever receives. */
        const html = sanitise(body.body_html || "");
        const id = clean(body.id, 60) || newId("mg");

        await db.query("mailing_upsert", {
          id, list_id: list.id, partner_id: partnerId,
          subject, preheader: plainLine(body.preheader, 160) || null,
          body_md: null, body_html: html, body_text: toText(html),
          created_by: actor.user_id || null, now,
        });
        const saved = await db.queryOne("mailing_one", { id, partner_id: partnerId });
        if (!saved) return json({ error: "That mailing has already been sent." }, 409);

        /* REPLACED, not diffed. The console sends the whole list every save,
           so removing one is a matter of not sending it — which is exactly
           what the delete button does. Cheap at this size, and there is no
           second code path that could disagree with the first. */
        await db.query("mailing_attachment_clear", { mailing_id: id });
        const files = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [];
        let n = 0;
        for (const f of files) {
          const key = clean(f.object_key, 200);
          /* The key has to be one this endpoint issued. Without this check a
             caller could name any object in the bucket and have it attached to
             a mailing going to a hundred people. */
          if (!key || !/^attachments\//.test(key)) continue;
          await db.query("mailing_attachment_add", {
            id: newId("at"), mailing_id: id,
            filename: clean(f.filename, 160) || "file",
            content_type: clean(f.content_type, 120) || "application/octet-stream",
            bytes: Math.max(0, Math.min(Number(f.bytes) || 0, 5 * 1024 * 1024)),
            object_key: key, sort_order: n++, now,
          });
        }
        saved.attachments = await db.query("mailing_attachments_for", { mailing_id: id });
        return json({ ok: true, mailing: saved });
      }

      if (body.action === "mailing-delete") {
        await db.query("mailing_delete",
          { id: clean(body.id, 60), partner_id: partnerId });
        return json({ ok: true });
      }

      /* ---- a test to yourself ----
         To the SIGNED-IN ADDRESS and nowhere else. A free-text "send test to"
         box is a way to send a newsletter to anybody while it is still called
         a test, which is both a way to leak a draft and a way around every
         consent rule this system has. */
      if (body.action === "mailing-test") {
        const m = await db.queryOne("mailing_one",
          { id: clean(body.id, 60), partner_id: partnerId });
        if (!m) return json({ error: "No such mailing." }, 404);
        const list = await db.queryOne("mailing_list_one",
          { id: m.list_id, partner_id: partnerId });
        if (!list) return json({ error: "No such list." }, 404);

        const origin = new URL(request.url).origin;
        const built = await buildMailing(db, env, { mailing: m, list, origin });
        if (built.error) return json({ error: built.error }, 400);

        const look = partnerId
          ? await db.queryOne("partner_settings", { partner_id: partnerId }) : null;
        /* A REAL unsubscribe link, for the test's own id rather than a
           subscriber's. It will not verify, which is correct — pressing it in
           a test must not remove anybody. What it proves is that the link is
           built, present, and the right shape. */
        /* THE TEST CARRIES THE ATTACHMENTS TOO. A test send that quietly
           leaves them out is a test of a different message, and the one thing
           it was for — seeing what actually arrives — is exactly what it
           would fail to show. */
        const msg = await messageFor(env, {
          built, list, origin,
          sub: { id: "test-" + (actor.user_id || "x"), email: actor.email },
          theme: look ? { accent: look.embed_accent, mode: look.embed_theme } : null,
          attachments: await loadAttachments(env,
            await db.query("mailing_attachments_for", { mailing_id: m.id })),
        });
        msg.subject = "[TEST] " + msg.subject;

        const sent = await sendMail(env, msg);
        return json({ ok: sent.ok === true, to: actor.email,
                      error: sent.ok ? undefined : sent.error },
                    sent.ok ? 200 : 502);
      }

      /* ---- the real one ---- */
      if (body.action === "mailing-send") {
        const id = clean(body.id, 60);
        const m = await db.queryOne("mailing_one", { id, partner_id: partnerId });
        if (!m) return json({ error: "No such mailing." }, 404);
        if (m.status !== "draft") {
          return json({ error: `This was already ${m.status}. A mailing is sent once.` }, 409);
        }
        const list = await db.queryOne("mailing_list_one",
          { id: m.list_id, partner_id: partnerId });
        if (!list) return json({ error: "No such list." }, 404);

        const origin = new URL(request.url).origin;
        const built = await buildMailing(db, env, { mailing: m, list, origin });
        if (built.error) return json({ error: built.error }, 400);

        const total = await db.queryOne("subscribers_to_send_count",
          { list_id: list.id, partner_id: partnerId });
        if (!total || !total.n) {
          return json({ error: "Nobody has confirmed on this list yet." }, 400);
        }
        /* A CAP, and it is honest about being one. Workers have a wall-clock
           budget, and a list larger than this needs sending in passes rather
           than a request that dies half way and leaves nobody able to say who
           was reached. Raising it is not the fix; a queue is, when a list is
           ever this big. */
        if (total.n > 400) {
          return json({
            error: `This list has ${total.n} confirmed subscribers, which is more ` +
                   `than one send can carry. Splitting large sends is not built yet.`,
          }, 400);
        }

        /* THE GUARD AGAINST SENDING TWICE, and it is a WHERE clause rather
           than the if-statement above: two requests arriving together both
           pass the check, and only one can win an UPDATE naming the old
           status. */
        const slug = slugify(built.subject) || ("m-" + id.slice(-6));
        const claim = await db.query("mailing_start",
          { id, partner_id: partnerId, slug, now });
        const recheck = await db.queryOne("mailing_one", { id, partner_id: partnerId });
        if (!recheck || recheck.status !== "sending") {
          return json({ error: "That mailing is already going out." }, 409);
        }

        const people = await db.query("subscribers_to_send",
          { list_id: list.id, partner_id: partnerId, limit: 500, offset: 0 });

        // Written down BEFORE anything leaves, so a crash mid-send still
        // leaves a record of who was meant to be reached.
        for (const sub of people) {
          await db.query("mailing_recipient_add", {
            mailing_id: id, subscriber_id: sub.id, email: sub.email,
            status: "pending", now,
          });
        }

        const look = partnerId
          ? await db.queryOne("partner_settings", { partner_id: partnerId }) : null;
        const theme = look ? { accent: look.embed_accent, mode: look.embed_theme } : null;
        /* Loaded ONCE for the whole send. Reading the same file per recipient
           would be a hundred fetches of one object and, at any real list size,
           more time than the request has. */
        const files = await loadAttachments(env,
          await db.query("mailing_attachments_for", { mailing_id: id }));

        const archiveUrl = list.archive_public
          ? `${origin}/archive/${s.partner ? s.partner.slug : "thauma"}/${list.slug}/${slug}`
          : null;

        /* ONE MESSAGE PER PERSON, deliberately not a batch. Each carries its
           own unsubscribe link, and a shared one would remove whoever pressed
           it from somebody else's row. */
        let sent = 0, failed = 0;
        for (const sub of people) {
          const msg = await messageFor(env,
            { built, list, sub, origin, theme, archiveUrl, attachments: files });
          const r = await sendMail(env, msg);
          if (r.ok) sent++; else failed++;
          await db.query("mailing_recipient_result", {
            mailing_id: id, subscriber_id: sub.id,
            status: r.ok ? "sent" : "failed",
            provider_id: r.id || null,
            error: r.ok ? null : String(r.error || "").slice(0, 300), now,
          });
        }

        await db.query("mailing_finish", {
          id, partner_id: partnerId,
          status: sent > 0 ? "sent" : "failed",
          sent_count: sent, now,
        });
        return json({ ok: sent > 0, sent, failed, total: people.length,
                      mailing: await db.queryOne("mailing_one", { id, partner_id: partnerId }) });
      }

      /* ---- the contact form ----
         One per ministry, so a save rather than a create. The organisation's
         own is the same row shape with a NULL partner, which is why the site's
         contact page could stop being a special case in code. */
      if (body.action === "contact-form") {
        const deliverTo = clean(body.deliver_to, 200);
        if (!deliverTo || !EMAIL_RE.test(deliverTo)) {
          return json({ error: "Messages need somewhere to go — add an address you read." }, 400);
        }

        const fromAddress = clean(body.from_address, 200);
        const allowed = (await db.query("sender_addresses_for_partner",
                                        { partner_id: partnerId })).map((a) => a.address);
        /* THE SAME RULE AS A MAILING LIST'S SENDER, and enforced here rather
           than only in the picker: the mail provider verifies domains, not
           addresses, so anything at a verified domain sends — including a
           typo, which leaves successfully and loses every reply. */
        if (fromAddress && allowed.length &&
            !allowed.some((a) => a.toLowerCase() === fromAddress.toLowerCase())) {
          return json({ error: `${fromAddress} is not one of the addresses set up for you.` }, 400);
        }
        /* Live with no sender is a form that collects messages and cannot
           deliver them. Refused rather than saved and discovered later. */
        if (body.is_open && !fromAddress) {
          return json({ error: "Choose a sending address before switching the form on." }, 400);
        }

        /* THE WHOLE DROPDOWN, REPLACED. The console sends every row on each
           save, so removing one is a matter of not sending it — which is what
           the delete button does. Cheap at this size, and there is no second
           code path that could disagree about ordering.

           Validated BEFORE anything is written, so a bad address in row three
           does not leave rows one and two saved and the rest gone. */
        const topics = Array.isArray(body.topics) ? body.topics.slice(0, 20) : [];
        const cleaned = [];
        const seen = new Set();
        for (const t of topics) {
          const label = clean(t.label, 80);
          if (!label) continue;
          /* Two identical options in a dropdown is a form that looks broken,
             and the unique index would refuse the write anyway — better to say
             so than to fail on the third row. */
          if (seen.has(label.toLowerCase())) {
            return json({ error: `"${label}" is listed twice.` }, 400);
          }
          seen.add(label.toLowerCase());
          const to = clean(t.deliver_to, 200);
          if (to && !EMAIL_RE.test(to)) {
            return json({ error: `"${to}" is not an email address.` }, 400);
          }
          cleaned.push({ label, deliver_to: to || null });
        }

        await db.query("contact_form_save", {
          partner_id: partnerId,
          deliver_to: deliverTo,
          from_address: fromAddress || null,
          heading: clean(body.heading, 120) || null,
          blurb: clean(body.blurb, 240) || null,
          button: clean(body.button, 40) || null,
          thanks: clean(body.thanks, 240) || null,
          is_open: body.is_open ? 1 : 0,
          now,
        });
        await db.query("contact_topics_clear", { partner_id: partnerId });
        for (let i = 0; i < cleaned.length; i++) {
          await db.query("contact_topic_add", {
            id: newId("ct"), partner_id: partnerId,
            label: cleaned[i].label, deliver_to: cleaned[i].deliver_to,
            sort_order: i, now,
          });
        }

        return json({ ok: true,
          contact: await db.queryOne("contact_form_for_partner", { partner_id: partnerId }),
          topics: await db.query("contact_topics_for_partner", { partner_id: partnerId }) });
      }

      /* ---- correcting somebody's details ----
         A NAME AND AN ADDRESS ARE NOT THE SAME KIND OF FACT.

         A name is a label and can be fixed freely. An address is the thing
         somebody consented with, so changing it puts the row back to
         'pending' and sends a fresh confirmation — otherwise "edit" would be
         a way to subscribe any address in the world without its owner ever
         agreeing, which is the exact thing double opt-in exists to prevent.

         It is also right for the innocent case: correcting a typo is a guess
         about a DIFFERENT mailbox, and that one has never said yes. */
      if (body.action === "subscriber-edit") {
        const id = clean(body.id, 60);
        const sub = await db.queryOne("subscriber_one", { id, partner_id: partnerId });
        if (!sub) return json({ error: "No such subscriber." }, 404);

        const name = clean(body.name, 120);
        if (name !== (sub.name || "")) {
          await db.query("subscriber_set_name", { id, name: name || null, now });
        }

        const email = clean(body.email, 200).toLowerCase();
        if (!email || !EMAIL_RE.test(email)) {
          return json({ error: "That does not look like an email address." }, 400);
        }
        if (email === sub.email.toLowerCase()) {
          return json({ ok: true, reconfirm: false });
        }

        const list = await db.queryOne("mailing_list_one",
          { id: sub.list_id, partner_id: partnerId });
        const token = crypto.randomUUID().replace(/-/g, "") +
                      crypto.randomUUID().replace(/-/g, "");
        try {
          await db.query("subscriber_change_email", { id, email, token, now });
        } catch (e) {
          // subscribers.email is UNIQUE per list.
          return json({ error: `${email} is already on this list.` }, 409);
        }

        const origin = new URL(request.url).origin;
        const sent = await sendMail(env, {
          to: email,
          ...listConfirmEmail({ list, token, origin, name: name || null }),
          from: `${list.from_name} <${list.from_email}>`,
          replyTo: list.reply_to || undefined,
        });
        return json({
          ok: true, reconfirm: true, email,
          sent: sent.ok === true,
          error: sent.ok ? undefined : sent.error,
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

      const id = clean(body.id, 60) || newId("ml");
      /* The slug the list already has, so a rename never moves its form. */
      const prior = body.id
        ? await db.queryOne("mailing_list_one", { id, partner_id: partnerId })
        : null;

      const allowed = (await db.query("sender_addresses_for_partner",
                                      { partner_id: partnerId })).map((a) => a.address);
      const { value, error } = cleanList(body, prior && prior.slug, allowed);
      if (error) return json({ error }, 400);
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

    return json({ error: "Method not allowed" }, 405,
                { Allow: "GET, POST, PUT, DELETE" });
  },
};
