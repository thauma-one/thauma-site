/**
 * lib/word-previews.js — the rest of Website › Pages' previews: the words
 * a visitor meets somewhere other than thauma.one's own pages
 *
 * Chase, 2026-10-28: "I was looking at the Admin Website Pages section, and
 * not every page has a preview." admin-translate.js previewOf drew the pages
 * after a link in an email and the emails; these are the others — the
 * notices, the forms and widgets on other websites, a ministry's own site,
 * its closed page and its app — each drawn by the very code that draws it
 * for a visitor, with the words as they are being written on Pages in place
 * of the saved ones (withWords).
 *
 * A SAMPLE MINISTRY, not a real one: its steps, goal, prayer and links are
 * the site's own suggested words ("A Resource We Recommend"…), the ones a
 * new site starts with, so the preview speaks the language being written
 * and nothing here needs translating. Its name is Thauma's.
 *
 * Fetching comes first and drawing after, without waiting in between:
 * withWords holds the words only while nothing else can run (mail-i18n.js).
 */
import { withWords, wordsFor, t } from "./mail-i18n.js";
import { lookFor } from "../embed-colour.js";
import { formScript } from "../signup.js";
import { contactScript } from "../contact.js";
import { noticeEmail, NOTICES } from "./notify.js";
import { WIDGET_JS } from "../embed-widget.js";
import { renderPage } from "../site/render.js";
import { appPreview } from "../site/app.js";
import { closedParts, closedHtml } from "../site/serve.js";
import { starter, placeholders, cleanDoc, word, PAGES } from "../site/model.js";

export const MORE_PREVIEWS = ["e:notify", "e:form", "e:contact", "e:widget", "e:dates", "e:site", "closed", "e:app"];
/* drawn with scripts: shown in a frame that may run them and nothing else */
const SCRIPTED = new Set(["e:form", "e:contact", "e:widget", "e:dates", "e:site", "e:app"]);

const NAME = "Thauma";
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inline = (js) => "<script>" + String(js).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--") + "</script>";

/** A page holding `body`, the way another website would. */
function page(lang, origin, body, bg = "#0b0f15") {
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="dark"><base href="${esc(origin)}/"></head>` +
    `<body style="margin:0;padding:32px 20px;background:${bg};display:grid;gap:40px">${body}</body></html>`;
}

/* ---- the sample ministry -------------------------------------------- */

/** What its widgets, site and app draw: the suggested words, in `lang`. */
function samplePayload(lang, origin) {
  const now = Date.now(), y = new Date().getFullYear();
  const w = (k) => word(lang, k);
  const tx = (title, description, extra = {}) => ({ [lang]: { title, description, ...extra } });
  const theme = lookFor({}, null);
  return {
    version: 1,
    partner: { slug: "thauma", display_name: NAME },
    theme,
    looks: { roadmap: theme, goal: theme, prayer: theme, videos: theme },
    timeline: { start: null, end: null },
    generated_at: new Date(now).toISOString(),
    languages: [{ code: lang, name: lang, native_name: lang }],
    /* every state a step can be in, each with a date written in words
       (dates.*), as the console writes them */
    milestones: [
      { id: "m1", parent_id: null, status: "complete", actual_date: iso(now - 200 * DAY), completion: 100, featured: false,
        text: tx(w("link1Title"), w("link1Text"), { target_label: t(lang, "dates.spring", { year: y }) }) },
      { id: "m2", parent_id: null, status: "canceled", actual_date: iso(now - 90 * DAY), completion: 0, featured: false,
        text: tx(w("cardTitle"), w("cardText"), { target_label: t(lang, "dates.summer", { year: y }) }) },
      { id: "m3", parent_id: null, status: "in_progress", actual_date: null, completion: 40, featured: true,
        text: tx(w("link2Title"), w("link2Text"), { target_label: t(lang, "dates.range", {
          from: t(lang, "dates.autumn", { year: y }), to: t(lang, "dates.winter", { year: y }) }) }) },
      { id: "m4", parent_id: null, status: "upcoming", actual_date: iso(now + 300 * DAY), completion: 0, featured: false,
        text: tx(w("rowTitle"), w("rowText"), { target_label: String(y + 1) }) },
    ],
    goals: [{ id: "g1", label: w("supportMission"), description: w("goalsFill"), kind: "monthly",
      target_cents: 300000, currency: "EUR", raised_cents: 192000, donor_count: 14, percent: 64,
      captured_at: new Date(now).toISOString(), text: {} }],
    prayer: [
      { id: "p1", is_answered: false, answered_on: null, text: tx(w("prayerFill"), w("missionFill")) },
      { id: "p2", is_answered: true, answered_on: iso(now - 30 * DAY), text: tx(w("link1Title"), w("link1Text"), { answer_text: w("quoteFill") }) },
    ],
    /* a video the widget will draw (an id shaped like YouTube's), its
       picture Thauma's own */
    videos: [{ id: "thaumaSample", title: w("videosFill"), published_at: new Date(now - 20 * DAY).toISOString(),
      url: "https://www.youtube.com/", embed_url: "", thumbnail_url: origin + "/img/og-default.png" }],
    video_links: [],
    mailings: [],
    shared: ["roadmap", "goal", "prayer", "videos"],
    /* the widget's words as embed.js ships them (English always there, the
       widget's fallback), these as typed */
    words: widgetWords(lang),
  };
}
function widgetWords(lang) {
  const all = wordsFor("widget."), out = {};
  for (const l of new Set(["en", lang])) {
    out[l] = Object.fromEntries(Object.entries(all[l] || all.en).map(([k, v]) => [k.slice("widget.".length), v]));
  }
  return out;
}

/** Its site: every kind of section, one after another on one page, each
    with the words a new section suggests. */
function sampleSite(lang) {
  const raw = starter("full", { name: NAME, langs: [lang], fallback: lang, give: "" });
  const ph = placeholders(lang, NAME);
  const one = (type, variant, extra = {}) => ({ id: "pv" + type, type, variant, words: { [lang]: { ...ph[type] } }, ...extra });
  const all = [];
  for (const p of raw.pages) all.push(...p.sections);
  all.splice(1, 0, one("header", "watermark"));
  all.push(one("define", "entry"), one("prayer", "list"),
    one("rows", "rows", { items: [1, 2].map(() => ({ words: { [lang]: { ...ph.row } } })) }),
    one("cards", "vertical", { items: [1, 2, 3].map(() => ({ words: { [lang]: { ...ph.card } } })) }));
  raw.pages.forEach((p) => {
    p.on = PAGES.includes(p.id);
    if (p.id === "home") p.sections = all;
  });
  return cleanDoc(raw, [lang]);
}

/* ---- the previews --------------------------------------------------- */

/** What the words draw, before anything is drawn: fetched first. */
async function gather(pageId, { db, env }) {
  if (pageId === "e:form") {
    const lists = await db.query("public_lists_for_signup_org", {}).catch(() => []);
    return { lists: lists.length ? lists : [{ slug: "updates", name: NAME, texts: null }] };
  }
  if (pageId === "e:contact") return { topics: await db.query("public_contact_topics_org", {}).catch(() => []) };
  if (pageId === "closed") return { parts: await closedParts(env) };
  return {};
}

/**
 * One preview: { html, subject?, sandbox? } — sandbox when it runs scripts,
 * so the console shows it in a frame of its own. Null for a page it does not
 * know.
 */
export async function previewMore(pageId, lang, words, { db, env, origin }) {
  if (!MORE_PREVIEWS.includes(pageId)) return null;
  const got = await gather(pageId, { db, env });
  const html = withWords(lang, words, () => draw(pageId, lang, origin, env, got));
  return { html, ...(SCRIPTED.has(pageId) ? { sandbox: true } : {}) };
}

function draw(pageId, lang, origin, env, got) {
  const theme = lookFor({}, null);
  switch (pageId) {
    /* every notice, one after another, each with its subject line above */
    case "e:notify": {
      const vars = { name: "Ana", email: "ana@example.com", by: NAME, areas: word(lang, "about") };
      const kinds = NOTICES.map((n) => n.kind);
      const mails = [];
      for (const kind of kinds) {
        for (const v of [undefined, ...variants(kind)]) {
          const m = noticeEmail(kind, { lang, origin, link: "/", ...vars, ...(v ? { _v: v } : {}) });
          mails.push(`<div style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#93a1b2;background:#0B0F15;padding:14px 22px;border-bottom:1px solid #1A222D">` +
            `<b style="color:#EDF2F8;font-weight:600">${esc(m.subject)}</b></div>` + bodyOf(m.html));
        }
      }
      return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"></head><body style="margin:0;background:#05070A">${mails.join('<div style="height:28px"></div>')}</body></html>`;
    }
    case "e:form":
      return page(lang, origin, `<div data-thauma-form data-lang="${esc(lang)}"></div>` +
        inline(formScript(got.lists, "thauma", origin, theme, {})));
    case "e:contact":
      return page(lang, origin, `<div data-thauma-contact data-lang="${esc(lang)}"></div>` +
        inline(contactScript({}, "thauma", origin, theme, got.topics, {})));
    case "e:widget":
    case "e:dates": {
      const kinds = pageId === "e:dates" ? ["roadmap"] : ["roadmap", "goal", "prayer", "videos"];
      return page(lang, origin, inline("window.__thaumaPreview=" + JSON.stringify(samplePayload(lang, origin)).replace(/</g, "\\u003c")) +
        kinds.map((k) => `<div data-thauma="thauma" data-widget="${k}" data-theme="dark" data-lang="${esc(lang)}"></div>`).join("") +
        inline(WIDGET_JS));
    }
    case "e:site": {
      const doc = sampleSite(lang), payload = samplePayload(lang, origin);
      const html = renderPage({ doc, payload, lang, pageId: "home", base: "", draft: true, origin, theme: payload.theme,
        site: { slug: "thauma", display_name: NAME, giving_url: null, subdomain: null },
        langNames: { [lang]: lang } });
      /* drawn as a preview (a photo not chosen yet says so), without the
         preview's own banner: these are the words, not a site to publish */
      return html.replace(/<head>/i, `<head><base href="${esc(origin)}/">`)
        .replace(/<div style="background:#F5B845[^>]*>[^<]*<\/div>/, "");
    }
    case "closed": return closedHtml(lang, env, got.parts);
    case "e:app": return appPreview({ payload: samplePayload(lang, origin), doc: sampleSite(lang), name: NAME, lang });
    default: return "";
  }
}

/* the other wordings a notice has (notify.<kind>_<part>_<variant>) */
function variants(kind) {
  return { profile_approved: ["edited", "partly"], site_published: ["both", "console", "site"] }[kind] || [];
}
function bodyOf(html) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}
