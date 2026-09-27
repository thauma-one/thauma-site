/**
 * when.js — a milestone's date, written as a sentence in any language
 *
 * Board 8 (Chase, 2026-09-26): the date is picked ONCE, at the precision
 * that is honest — a day, a month, a season or a year, optionally a range —
 * and every language's "When" is written from it. The sentence is stored in
 * milestone_translations.target_label, so every public reader (the embed
 * widget, the partner API, chaseroush.com) keeps reading what it always read.
 *
 * Months, days and years come from Intl, which knows every language the
 * console can add. Seasons are not in Intl, so their words are public wording
 * in src/_data/emailsAndForms.json ("dates"), translated on the Translate page
 * like the rest of it.
 *
 * THE CONSOLE PREVIEWS THE SAME SENTENCES in src/js/staff-milestones.js
 * (whenLabel there). test/milestone-dates.test.mjs runs both over the same
 * dates and fails if they ever disagree.
 */
import { t } from "./mail-i18n.js";

export const PRECISIONS = ["day", "month", "season", "year"];

/* A season is stored as the first day of its first month. */
const SEASON_OF = { 3: "spring", 6: "summer", 9: "autumn", 12: "winter" };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Snap a date to the start of its precision: a month to its first day, a
 * season to the first day of the season it falls in, a year to 1 January.
 * Returns null for anything that is not a real YYYY-MM-DD.
 */
export function snap(precision, iso) {
  const m = ISO.exec(String(iso || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n) => String(n).padStart(2, "0");
  if (precision === "day") return `${y}-${pad(mo)}-${pad(d)}`;
  if (precision === "month") return `${y}-${pad(mo)}-01`;
  if (precision === "year") return `${y}-01-01`;
  if (precision === "season") {
    /* January and February belong to the winter that began the December
       before. */
    if (mo < 3) return `${y - 1}-12-01`;
    const start = mo >= 12 ? 12 : mo >= 9 ? 9 : mo >= 6 ? 6 : 3;
    return `${y}-${pad(start)}-01`;
  }
  return null;
}

const asDate = (iso) => new Date(iso + "T12:00:00Z");
const INTL = {
  day: { day: "numeric", month: "long", year: "numeric" },
  month: { month: "long", year: "numeric" },
  year: { year: "numeric" },
};

function one(lang, precision, iso) {
  if (precision === "season") {
    const [y, mo] = iso.split("-").map(Number);
    return t(lang, "dates." + SEASON_OF[mo], { year: y });
  }
  return new Intl.DateTimeFormat(lang, { ...INTL[precision], timeZone: "UTC" }).format(asDate(iso));
}

/**
 * The sentence for one language, or null when there is no date to write.
 * `start` and `end` are already snapped; an end that is missing, equal to the
 * start or before it is a single date.
 */
export function whenLabel(lang, precision, start, end) {
  if (!PRECISIONS.includes(precision) || !start) return null;
  const range = end && end > start;
  if (!range) return one(lang, precision, start);
  if (precision === "season") {
    return t(lang, "dates.range", { from: one(lang, precision, start), to: one(lang, precision, end) });
  }
  return new Intl.DateTimeFormat(lang, { ...INTL[precision], timeZone: "UTC" })
    .formatRange(asDate(start), asDate(end));
}
