/**
 * fresh.js — "someone else saved this while you had it open"
 *
 * Chase, 2026-09-30: "The challenge occurs when we have someone editing a
 * file on the live site (like a staff user) while I'm editing the dev site.
 * So we almost need this timestamp cross referencing system in place for all
 * actions so things can be added and in sync without removing data."
 *
 * Every site shares one database (wrangler.toml, ONE DATABASE), so two
 * people can open the same record — Chase on dev, a staff member on live —
 * and without this the second save silently overwrites the first.
 *
 * THE RULE, used by every editor that saves a record it loaded:
 *   · the editor sends back the record's updated_at as it was when opened
 *   · the endpoint compares it with the record as it is now, just before
 *     writing (the same request, milliseconds apart — ample for people)
 *   · if it moved, nothing is written: 409, `changed: true`, with the record
 *     as it now is, so the editor can show it and ask "keep theirs, or save
 *     mine over it?" — and "save mine" sends `overwrite: true`
 *
 * A new record, an editor that did not send updated_at, or overwrite: true
 * all save as before. The one thing that no longer happens is losing
 * somebody's work without anyone being told.
 */
import { json } from "./store.js";

/**
 * True when `current` was saved after the version the editor opened.
 *
 * By updated_at where the table keeps one. Where it does not (interactions,
 * mailings), the editor sends `base` — the record as it loaded it — and the
 * named `fields` are compared instead: a conflict only when something
 * actually changed.
 */
export function changedSince(body, current, fields) {
  if (!body || !current || body.overwrite === true) return false;
  const opened = body.updated_at, now = current.updated_at;
  if (opened && now) return String(opened) !== String(now);
  if (fields && body.base && typeof body.base === "object") {
    /* true/1 and false/0 are one value: the page holds booleans where the
       database keeps integers, and that is not somebody else's edit. */
    const norm = (v) => (v === undefined || v === null ? "" : v === true ? "1" : v === false ? "0"
      : typeof v === "object" ? JSON.stringify(v) : String(v));
    return fields.some((f) => f in body.base && norm(body.base[f]) !== norm(current[f]));
  }
  return false;
}

/** The answer when it has: nothing written, and the record as it now is. */
export function changedAnswer(current, extra = {}) {
  return json({
    error: "Someone else saved this while you had it open.",
    changed: true,
    at: current.updated_at,
    current,
    ...extra,
  }, 409);
}
