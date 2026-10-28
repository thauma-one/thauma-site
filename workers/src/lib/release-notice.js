/**
 * release-notice.js — "the site was updated", sent once it IS live (0064)
 *
 * Chase, 2026-10-19: "When the site is published, the notification should
 * appear after the site is live. The verbiage should also be rephrased …
 * Summarize the changes more effectively … especially the changes that go to
 * Partners … 'The Staff Console was updated' or the like … we don't need the
 * 'the site will be live in a few minutes' part … the update emails should
 * always point to thauma.one, not dev.thauma.one."
 *
 *   Publish (admin-publish.js) cuts the release and marks it waiting.
 *   The quarter-hourly job (worker.js scheduled) calls sendWaitingReleases:
 *   once a production deploy that STARTED after the press has succeeded, one
 *   site claims the release (the three share one database) and tells everyone
 *   with something of their own in it.
 *
 * EACH PERSON IS TOLD WHAT CHANGED FOR THEM: the pages of theirs with
 * entries ("Site Creator, Updates and Mail"), and a heading by what those
 * are — the Staff Console, the website, or both ("Thauma Was Updated").
 * Links and the email's footer are always thauma.one: notices are managed in
 * the live console, wherever Publish was pressed.
 */
import { sectionsFor, tells, seesWebsite } from "../changes.js";
import { notify } from "./notify.js";
import { lastSuccessfulRun } from "./github.js";
import { t } from "./mail-i18n.js";

export const LIVE = "https://thauma.one";
const rolesOf = (who) => String((who && who.roles) || "").split(",").filter(Boolean);

function joined(lang, names) {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length < 2) return list[0] || "";
  return list.slice(0, -1).join(", ") + " " + t(lang, "notify.and") + " " + list[list.length - 1];
}

/** One person's words for a release: which variant, and their areas. */
export function releaseVars(release, who) {
  const lang = (who && who.preferred_lang) || "en";
  const roles = rolesOf(who);
  const pages = sectionsFor(release.entries || [], roles, "en").map((s) => s.page);
  const content = seesWebsite(roles) && (release.content || []).length > 0;
  const names = pages.map((p) => t(lang, "notify.area_" + p.replace(":", "_")));
  if (content) names.push(t(lang, "notify.area_content"));
  const site = pages.includes("site") || content;
  const consolePart = pages.some((p) => p !== "site");
  return { _v: site && consolePart ? "both" : site ? "site" : "console", areas: joined(lang, names) };
}

/** Tell everyone with something of their own in this release. */
export async function tellRelease(env, db, release) {
  return notify(env, db, "site_published", { by: release.by_name || "Thauma" }, {
    origin: LIVE,
    link: "/staff/changes/" + (release.id ? "#" + release.id : ""),
    only: (who) => tells(release, rolesOf(who)),
    varsFor: (who) => releaseVars(release, who),
  });
}

const parse = (v) => { try { return JSON.parse(v || "[]"); } catch { return []; } };

/** The scheduled job: send every waiting release whose build is live. */
export async function sendWaitingReleases(env, db, { fetchImpl } = {}) {
  let waiting;
  try { waiting = await db.query("releases_waiting", {}); } catch { return { skipped: "not applied" }; }
  if (!waiting.length) return { sent: 0 };
  const run = await lastSuccessfulRun(env, "deploy.yml", fetchImpl);
  if (!run || run.error || run.never) return { waiting: waiting.length, error: run && run.error };
  let sent = 0;
  for (const r of waiting) {
    /* a deploy that STARTED after the press — one already running then
       built the code before this release */
    if (!(String(run.started || run.at) >= String(r.notify_after))) continue;
    const claimed = await db.query("release_claim", { id: r.id, now: new Date().toISOString() }).catch(() => []);
    if (!claimed.length) continue;
    sent += (await tellRelease(env, db, { id: r.id, by_name: r.by_name, entries: parse(r.entries), content: parse(r.content) })).sent;
  }
  return { sent };
}
