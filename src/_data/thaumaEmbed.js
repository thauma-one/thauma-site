// thaumaEmbed.js — Thauma's own Events and Resources, for other websites
//
// Chase, 2026-10-27: "Events and Resources don't have the Sharing visualizers
// anywhere. Anything that is in Updates for staff has a visualizer in the
// sharing tab." A ministry's updates are shared through /embed/v1/<slug>.json
// and widget.js; Thauma's two collections live in files, not the database,
// so they are written out with the site (embed-data.njk →
// /embed-data/thauma.json) and the worker hands that file to widget.js as
// "thauma" (embed.js). The same words and the same addresses as thauma.one's
// own pages, because they are made from the same data in the same build.
//
// SHARED WHILE THE PAGE IS: a collection is offered only while its page is on
// in this build's column — what a visitor could already read on thauma.one,
// nothing more. No switch of its own; Sharing says so.
//
// A FUNCTION, as every data file here (see visible.js).
const fs = require("node:fs");
const path = require("node:path");

const ORIGIN = "https://thauma.one";

module.exports = () => {
  const visible = require("./visible.js")();
  const langs = require("./activeLangs.js")();
  const words = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, "i18n", l + ".json"), "utf8"));
  const T = Object.fromEntries(langs.map((l) => [l, words(l)]));
  const per = (fn) => Object.fromEntries(langs.map((l) => [l, fn(l)]));
  const plain = (s) => String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  const eventsOn = visible.page("events") && !visible.comingSoon;
  const resourcesOn = visible.page("resources") && !visible.comingSoon;

  const events = !eventsOn ? [] : require("./gatherings.js")().filter((g) => g.status !== "canceled").map((g) => ({
    slug: g.slug, type: g.type, status: g.status,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(g.date || "")) ? g.date : null,
    date_label: g.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(g.date)) ? String(g.date) : null,
    location: g.location ? String(g.location) : null,
    title: g.title || {}, summary: g.summary || {},
    url: per((l) => `${ORIGIN}/${l}/events/`),
  }));
  const resources = !resourcesOn ? [] : require("./resources.js")().map((r) => ({
    slug: r.slug, format: r.format, moment: r.moment,
    title: r.title || {}, summary: r.summary || {},
    url: per((l) => `${ORIGIN}/${l}/resources/${r.slug}/`),
  }));

  return {
    partner: { slug: "thauma", name: "Thauma", display_name: "Thauma", url: ORIGIN },
    languages: langs.map((code) => ({ code })),
    shared: [...(eventsOn ? ["events"] : []), ...(resourcesOn ? ["resources"] : [])],
    /* Thauma's two voices: the technical blue and the ministry's seafoam */
    theme: { accent: "#2FD8FF", accent2: "#5CF2C4", mode: "dark" },
    events, resources,
    /* the site's own words for what the widgets say; the widget's own
       (words) are added by the worker, from the same file a ministry's are */
    site_words: per((l) => {
      const t = T[l], e = t.events || {}, r = t.resources || {};
      return {
        events: plain(e.title), upcoming: plain(e.invited), past: plain(e.past_cue), where: plain(e.where_label),
        none: plain(e.empty_title), resources: plain(r.title), open: plain(r.link_label),
        formats: Object.fromEntries(Object.keys(r).filter((k) => k.startsWith("fmt_")).map((k) => [k.slice(4), plain(r[k])])),
        all: plain(r.all_label),
      };
    }),
    generated_at: new Date().toISOString(),
  };
};
