/**
 * lib/form-preview.js — the sign-up and contact forms as Sharing has them on
 * screen, saved or not
 *
 * Chase, 2026-10-28: "make the Sharing previews match what actually show up
 * on that web page … and then reflect any changes as well even if they
 * aren't saved yet". form.js and contact.js are built on the server from
 * what is saved, so a list switched on or a reason typed in Sharing could
 * not reach its preview until Save. Sharing now sends its working copy and
 * gets the script back built from it: the same formScript and contactScript
 * a visitor gets, handed the lists switched on there, the reasons and the
 * words as typed. Nothing is stored; the console draws it and that is all.
 *
 * Used twice: the preview of a form pasted on another website
 * (staff-mailing.js, action "form-preview") and a ministry's own site drawn
 * with Sharing's working copy (site/serve.js, a POST to a ?draft page).
 */
import { formScript } from "../signup.js";
import { contactScript } from "../contact.js";
import { lookFor } from "../embed-colour.js";
import { cleanLabels } from "./topics.js";

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const HEX = /^#[0-9a-fA-F]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const line = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/* Each language's words, as form_words keeps them (staff-mailing.js). */
function cleanWords(raw, contact) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [lang, w] of Object.entries(raw).slice(0, 40)) {
    if (!LANG_RE.test(lang) || !w || typeof w !== "object") continue;
    out[lang] = { heading: line(w.heading, 120), blurb: line(w.blurb, 240), button: line(w.button, 40),
                  thanks: contact ? line(w.thanks, 240) : "" };
  }
  return out;
}

/**
 * The forms' part of Sharing's working copy, made safe to draw. A part left
 * out stays as saved (undefined).
 */
export function cleanFormDraft(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (Array.isArray(raw.lists)) {
    out.lists = raw.lists.map((id) => line(id, 80)).filter(Boolean).slice(0, 100);
    out.signupOpen = raw.signupOpen !== false;
    out.signupWords = cleanWords(raw.signupWords, false);
  }
  if (Array.isArray(raw.topics)) {
    out.contactOpen = raw.contactOpen !== false;
    /* A reason has an id once saved; a new one gets one for the dropdown. */
    out.topics = raw.topics.slice(0, 40).map((t, i) => ({
      id: "p" + i, label: line(t && t.label, 80), labels: cleanLabels(t && t.labels),
    })).filter((t) => t.label);
    out.contactWords = cleanWords(raw.contactWords, true);
  }
  return out;
}

/**
 * The scripts for `forms` (cleanFormDraft): { signup, contact }, each the
 * script text, "" for a form the working copy has closed (a visitor would get
 * nothing), or undefined where the working copy says nothing of it.
 *
 * @param partnerId  the ministry's id, or null for Thauma's own
 */
export async function draftFormScripts(db, { partnerId, slug, origin, look, forms }) {
  const theme = lookFor(look || {}, null);
  const out = {};
  if (forms.lists) {
    const lists = forms.signupOpen
      ? (await db.query("mailing_lists_for_partner", { partner_id: partnerId }))
        .filter((l) => forms.lists.includes(l.id))
      : [];
    out.signup = lists.length ? formScript(lists, slug, origin, theme, forms.signupWords) : "";
  }
  if (forms.topics) {
    out.contact = forms.contactOpen
      ? contactScript({}, slug, origin, theme, forms.topics, forms.contactWords) : "";
  }
  return out;
}

/**
 * The ministry's look and period in Sharing's working copy, laid over its
 * partner row (embedPayload reads the row), for a ?draft page drawn with it.
 */
export function withSharingDraft(partner, raw) {
  if (!raw || typeof raw !== "object") return partner;
  const p = { ...partner };
  if (HEX.test(raw.accent || "")) {
    p.embed_accent = raw.accent;
    p.embed_accent2 = HEX.test(raw.accent2 || "") ? raw.accent2 : null;
    p.embed_turn = Number.isInteger(raw.turn) ? raw.turn : null;
  }
  if (["auto", "light", "dark"].includes(raw.theme)) p.embed_theme = raw.theme;
  if (raw.period && typeof raw.period === "object") {
    p.timeline_start = DAY.test(raw.period.start || "") ? raw.period.start : null;
    p.timeline_end = DAY.test(raw.period.end || "") ? raw.period.end : null;
  }
  return p;
}

/**
 * Each widget's own colors in Sharing's working copy, over the payload's
 * (embedPayload reads them saved): on the ministry's site a widget wears its
 * own accent too, unless the site is Custom (embed-widget.js).
 */
export function withDraftLooks(payload, partner, raw) {
  const looks = raw && raw.looks;
  if (!looks || typeof looks !== "object" || !payload.looks) return payload;
  for (const kind of Object.keys(payload.looks)) {
    const l = looks[kind];
    if (!l || typeof l !== "object") continue;
    const own = HEX.test(l.accent || "");
    payload.looks[kind] = lookFor(partner, {
      accent: own ? l.accent : null, accent2: own && HEX.test(l.accent2 || "") ? l.accent2 : null,
      turn: own && Number.isInteger(l.turn) ? l.turn : null,
      theme: ["auto", "light", "dark"].includes(l.theme) ? l.theme : null,
    });
  }
  return payload;
}
