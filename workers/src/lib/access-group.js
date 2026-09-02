/**
 * access-group.js — keeping Cloudflare Access in step with the People page
 *
 * TWO DOORS, ONE OF THEM NOW AUTOMATIC. A row in `users` has never let anybody
 * in: Cloudflare Access decides who reaches the site at all, and the two lists
 * were maintained by hand in two dashboards. This closes that gap from the
 * side we control — adding somebody in the console adds them to the Access
 * group, and removing them takes them out.
 *
 * IT IS STILL TWO DOORS. The database row and the Access entry remain separate
 * facts, and this only keeps them in step when the console is the thing making
 * the change. Somebody edited into Access by hand is still invisible here, and
 * that is fine: Access decides who may knock, `users` decides who is answered.
 *
 * A GROUP, NOT A POLICY. A policy carries include/exclude/require rules that
 * somebody set up deliberately; rewriting one to append an address means
 * read-modify-writing rules this code did not author, and one malformed
 * response would drop them. A group is a list of people and nothing else,
 * which is the only shape safe to edit programmatically.
 *
 * IT IS OPTIONAL EVERYWHERE. With no token configured, every function here
 * reports "not configured" and the caller carries on — an account still gets
 * created, and the administrator is told to add them to Access by hand. A
 * deployment that cannot reach Cloudflare must not be a deployment that cannot
 * add a person.
 */

const API = "https://api.cloudflare.com/client/v4";

/** Is this deployment set up to edit the Access group? */
export function accessConfig(env) {
  const token = env.ACCESS_API_TOKEN;
  const account = env.ACCESS_ACCOUNT_ID;
  const group = env.ACCESS_GROUP_NAME;
  if (!token || !account || !group) {
    return { ok: false, reason: "Cloudflare Access is not wired up on this deploy." };
  }
  return { ok: true, token, account, group };
}

async function call(cfg, path, init = {}) {
  const res = await fetch(`${API}/accounts/${cfg.account}/access/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!body.success) {
    const why = (body.errors || []).map((e) => e.message).join("; ")
      || `HTTP ${res.status}`;
    throw new Error(why);
  }
  return body.result;
}

/**
 * The group, found by NAME.
 *
 * By name rather than by id so nobody has to copy a UUID out of a dashboard
 * into a configuration file — the id is looked up here and the thing a person
 * types is the thing they see on screen. The cost is one extra request, which
 * only happens when somebody is added or removed.
 */
export async function findGroup(cfg, fetchImpl) {
  const groups = await call({ ...cfg }, "groups", { method: "GET" });
  const hit = (groups || []).find(
    (g) => String(g.name).trim().toLowerCase() === cfg.group.trim().toLowerCase());
  if (!hit) {
    throw new Error(
      `No Access group called "${cfg.group}". Create it in Zero Trust ` +
      `(Access -> Groups) and point your application's policy at it.`);
  }
  return hit;
}

/** Every address the group's include rules name. */
export function emailsIn(group) {
  return (group.include || [])
    .map((r) => r && r.email && r.email.email)
    .filter(Boolean)
    .map((e) => e.toLowerCase());
}

/** Include rules with the email ones replaced by `emails`, others untouched. */
function withEmails(group, emails) {
  const others = (group.include || []).filter((r) => !(r && r.email && r.email.email));
  return [...others, ...emails.map((email) => ({ email: { email } }))];
}

async function save(cfg, group, include) {
  /* PUT replaces the group, so every field it should keep is sent back. Only
     `include` is being changed; require and exclude are carried through
     untouched because this code did not author them and must not decide they
     were unimportant. */
  return await call(cfg, `groups/${group.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: group.name,
      include,
      exclude: group.exclude || [],
      require: group.require || [],
    }),
  });
}

/**
 * Add an address, if it is not already there.
 *
 * Returns { added: true } or { added: false, already: true } — the second is a
 * success. Somebody added to Access by hand and then created in the console is
 * an ordinary sequence, not a conflict.
 */
export async function addEmail(env, email) {
  const cfg = accessConfig(env);
  if (!cfg.ok) return { ok: false, reason: cfg.reason };

  const want = String(email || "").trim().toLowerCase();
  if (!want) return { ok: false, reason: "no address given" };

  const group = await findGroup(cfg);
  const have = emailsIn(group);
  if (have.includes(want)) return { ok: true, already: true, group: group.name };

  await save(cfg, group, withEmails(group, [...have, want]));
  return { ok: true, added: true, group: group.name };
}

/**
 * Remove an address.
 *
 * `keep` is the protected account, and it is passed in rather than looked up
 * so this file needs to know nothing about the schema. Removing it from Access
 * would lock the site's own failsafe out with a perfectly good database row —
 * the half of that guarantee 0026_protected_account.sql cannot enforce,
 * because a database cannot see Cloudflare.
 */
export async function removeEmail(env, email, { keep = [] } = {}) {
  const cfg = accessConfig(env);
  if (!cfg.ok) return { ok: false, reason: cfg.reason };

  const drop = String(email || "").trim().toLowerCase();
  if (!drop) return { ok: false, reason: "no address given" };
  if (keep.map((k) => String(k).toLowerCase()).includes(drop)) {
    return { ok: false, protected: true,
             reason: "that address is the protected account and stays in Access" };
  }

  const group = await findGroup(cfg);
  const have = emailsIn(group);
  if (!have.includes(drop)) return { ok: true, already: true, group: group.name };

  await save(cfg, group, withEmails(group, have.filter((e) => e !== drop)));
  return { ok: true, removed: true, group: group.name };
}
