/**
 * email-look.js — how a ministry's email looks
 *
 * Chase, 2026-10-04: "each ministry's email should be built from the site's
 * design, but an email designer may be good too! That way they have complete
 * transparency as to what they have access to."
 *
 * ONE ANSWER for every place an email is drawn — a send, a test, the size
 * measure, the public archive — so they cannot disagree.
 *
 * FOLLOWING THE WEBSITE (the default when a ministry has one): the PUBLISHED
 * site's look — its surfaces, ink and accent (site/render.js looks()), light
 * or dark as the site is, its heading and body fonts, its logo or name, and
 * its footer's tagline and small print. The published copy, never the
 * draft: an email goes out now, to people who will click through to what is
 * live.
 *
 * THE DESIGNER (partners.email_look, 0050) holds the same choices, all of
 * them visible, so a ministry sees exactly what it can change. Changing any
 * one stops following the website (`follow: false`) and keeps every other
 * value as it was — the photo editor's "dragging a corner makes it Free".
 *
 * EMAIL, NOT A WEB PAGE: every color a solid hex (Outlook drops rgba), fonts
 * named first and then the stacks every client has, and the web fonts only
 * as a <link> that Apple Mail uses and Gmail ignores.
 */
import { looks, FONTS } from "../site/render.js";
import { lookFor } from "../embed-colour.js";

export const MODES = ["light", "dark"];
export const FONTS_OF = ["site", "sans", "serif"];
export const HEADERS = ["name", "logo", "none"];
export const CORNERS = ["square", "soft", "round"];

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,Cambria,'Times New Roman',serif";
const HEX = /^#[0-9a-fA-F]{6}$/;

/* The plain light and dark an email had before it followed anything. */
const PLAIN = {
  light: { bg: "#f4f5f8", card: "#ffffff", ink: "#1a1a22", dim: "#5c5c6b", line: "#e6e6ee" },
  dark: { bg: "#15151c", card: "#1c1c25", ink: "#f2f2f7", dim: "#9a9aad", line: "#2a2a36" },
};

/* "rgba(26,28,34,.12)" laid on a solid ground, as one hex. */
function solid(color, ground) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(String(color));
  if (!m) return HEX.test(String(color)) ? color : ground;
  const a = m[4] == null ? 1 : +m[4];
  const g = parseInt(ground.slice(1), 16), gr = [g >> 16, (g >> 8) & 255, g & 255];
  return "#" + [1, 2, 3].map((i, k) => Math.round(+m[i] * a + gr[k] * (1 - a)).toString(16).padStart(2, "0")).join("");
}
const lum = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
};
const onColor = (hex) => (lum(hex) > 0.35 ? "#12121a" : "#ffffff");
/* The family named in a site look ("'Sora', system-ui, sans-serif") with the
   email-safe stack behind it. */
const stackOf = (cssFont, serif) => {
  const first = String(cssFont || "").split(",")[0].trim();
  return (first && !/system-ui/.test(first) ? first + "," : "") + (serif ? SERIF : SANS);
};

/** The designer's saved choices, made safe. */
export function cleanEmailLook(v) {
  const o = v && typeof v === "object" ? v : {};
  const pick = (x, list, d) => (list.includes(x) ? x : d);
  return {
    follow: o.follow !== false,
    mode: pick(o.mode, MODES, "light"),
    font: pick(o.font, FONTS_OF, "site"),
    header: pick(o.header, HEADERS, "name"),
    corners: pick(o.corners, CORNERS, "soft"),
    bar: o.bar !== false,
    footer: o.footer !== false,
    site: o.site !== false,
  };
}

/**
 * Everything render() needs.
 * @param doc     the ministry's PUBLISHED site (cleaned), or null
 * @param theme   the ministry's colors { accent, accent2, mode }
 * @param saved   partners.email_look (parsed), or null
 * @param siteUrl the live site's address, or null
 * @param lang    which language's footer words
 */
export function emailLook({ doc = null, theme = {}, saved = null, siteUrl = null, lang = "en" } = {}) {
  const accent = HEX.test(String(theme.accent || "")) ? theme.accent : "#6D4AFF";
  const accent2 = HEX.test(String(theme.accent2 || "")) ? theme.accent2 : accent;
  const choice = cleanEmailLook(saved);
  const design = doc && doc.design;
  const follow = !!design && choice.follow;

  /* What the website would give, whether or not it is being followed: the
     designer shows these as the starting point. */
  const fromSite = design ? (() => {
    const L = looks(design.look, { accent, accent2 }, design.colors || {}, design.mode);
    const mode = L.scheme === "dark" || lum(L.bg) < 0.2 ? "dark" : "light";
    const card = solid(L.panel, L.bg);
    const fw = (f) => {
      const w = (doc.footer && doc.footer.words) || {};
      return (w[lang] && w[lang][f]) || (w[doc.fallback] && w[doc.fallback][f]) || "";
    };
    return {
      mode, bg: L.bg, card, ink: L.fg, dim: solid(L.dim, card), line: solid(L.line, card),
      accent: L.acc || accent, accent2: L.acc2 || accent2,
      headFont: stackOf(L.display, /(^|,)\s*serif\s*$/.test(L.display)),
      bodyFont: stackOf(L.body, false),
      fontsUrl: FONTS[design.look] ? `https://fonts.googleapis.com/css2?${FONTS[design.look]}&display=swap` : null,
      header: design.brand === "logo" && design.logo ? "logo" : "name",
      logo: design.logo || null,
      tagline: fw("tagline"), small: fw("small"),
    };
  })() : null;

  let out;
  if (follow) {
    out = { ...fromSite, corners: "soft", bar: true, footer: true, site: !!siteUrl };
  } else {
    const mode = choice.follow ? (theme.mode === "dark" ? "dark" : "light") : choice.mode;
    const P = PLAIN[mode];
    const serif = choice.font === "serif";
    const siteFonts = choice.font === "site" && fromSite;
    out = {
      mode, ...P, accent, accent2,
      headFont: siteFonts ? fromSite.headFont : serif ? SERIF : SANS,
      bodyFont: siteFonts ? fromSite.bodyFont : serif ? SERIF : SANS,
      fontsUrl: siteFonts ? fromSite.fontsUrl : null,
      header: choice.header === "logo" && !(fromSite && fromSite.logo) ? "name" : choice.header,
      logo: fromSite ? fromSite.logo : null,
      tagline: fromSite ? fromSite.tagline : "", small: fromSite ? fromSite.small : "",
      corners: choice.corners, bar: choice.bar, footer: choice.footer && !!fromSite, site: choice.site && !!siteUrl,
    };
  }
  out.onAccent = onColor(out.accent);
  out.siteUrl = out.site ? siteUrl : null;
  out.follow = follow;
  out.hasSite = !!design;
  out.hasLogo = !!(fromSite && fromSite.logo);
  /* What the designer shows for each choice while following: the values the
     website gives, so the controls never lie about what is in use. */
  out.choice = follow
    ? { follow: true, mode: out.mode, font: "site", header: out.header, corners: "soft", bar: true, footer: true, site: true }
    : { ...choice, follow: false };
  return out;
}

/**
 * A ministry's look, read from the database: its colors, its PUBLISHED and
 * switched-on site, and its designer's choices. Thauma's own mail (no
 * partner) keeps the plain email. Every read is tolerant: a deploy whose
 * database lacks 0050, or a site row, still sends.
 */
export async function lookForMail(db, partnerId, { lang } = {}) {
  if (!partnerId) return null;
  const face = await db.queryOne("partner_for_site", { partner_id: partnerId }).catch(() => null);
  if (!face) return null;
  const pair = lookFor(face);
  const site = await db.queryOne("partner_site_get", { partner_id: partnerId }).catch(() => null);
  let doc = null;
  if (site && site.enabled && site.published) { try { doc = JSON.parse(site.published); } catch { doc = null; } }
  let saved = null;
  try {
    const row = await db.queryOne("partner_email_look", { partner_id: partnerId });
    saved = row && row.email_look ? JSON.parse(row.email_look) : null;
  } catch { saved = null; }
  /* The live address, whatever deploy is sending: the reader is real. */
  const siteUrl = doc && site.subdomain ? `https://${site.subdomain}.thauma.one/` : null;
  return emailLook({ doc, theme: { accent: pair.accent, accent2: pair.accent2, mode: face.embed_theme }, saved, siteUrl, lang });
}
