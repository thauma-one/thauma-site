#!/usr/bin/env node
/**
 * A partner's mailing lists, and the wall around them
 *   node workers/test/staff-mailing.test.mjs
 *
 * WHAT THIS TESTS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * db/test_schema.py proves the DATABASE refuses a subscriber whose partner
 * disagrees with its list. That is the wall. This proves the ENDPOINT never
 * hands the database a partner id that came from the caller — because a
 * perfect wall does not help if the code politely carries requests over it.
 *
 * So every query call is recorded and its partner_id asserted against the
 * partner resolved from the SIGNED-IN ACCOUNT. A request that names a partner,
 * a list, or a subscriber belonging to somebody else must still be scoped to
 * the caller's own.
 */
import handler, { cleanList, slugify } from "../src/staff-mailing.js";
/* The generated SQL, so the tests below assert on what the Worker actually
   runs rather than on a copy of it in a string here. */
import { QUERIES } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- a real Access token, verified for real ---- */
const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1"; jwk.alg = "RS256";
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
const p = enc({ iss: `https://${TEAM}`, aud: AUD, email: "chase@thauma.one", sub: "u-1",
                exp: Math.floor(Date.now() / 1000) + 600 });
const TOKEN = `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
  pair.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;

globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + url);
};

/**
 * A database that records every call. Returns plausible rows so the handler
 * reaches its own logic, and keeps the params so the test can inspect them.
 */
function envWith(roles = "staff", { partners = [{ id: "p_chase", display_name: "Chase" }], languages = null } = {}) {
  const calls = [];
  const env = {
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
    calls,
    DB: {
      prepare(sql) {
        const run = async () => {
          calls.push({ sql, params: env._lastParams });
          /* partner_users FIRST. partners_for_user selects FROM users too, so
             matching on that alone hands back an identity row where a list of
             partners was asked for — which made an account with no partner
             look like it had one. */
          if (/partner_users/i.test(sql)) return { results: partners };
          if (languages && /FROM languages/i.test(sql)) return { results: languages };
          if (/FROM users/i.test(sql) && /email/i.test(sql)) {
            return { results: [{ user_id: "u_1", email: "chase@thauma.one",
                                 user_name: "Chase", status: "active", roles }] };
          }
          if (/FROM mailing_lists/i.test(sql)) {
            return { results: [{ id: "ml_1", partner_id: "p_chase", slug: "newsletter",
                                 name: "News", from_name: "C", from_email: "c@x.one" }] };
          }
          return { results: [] };
        };
        return { bind(...args) { env._lastParams = args; return { all: run, run }; },
                 all: run, run };
      },
    },
  };
  return env;
}

const req = (method, { body, query = "" } = {}) =>
  new Request(`https://x/api/staff-mailing${query}`, {
    method,
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });

/** Every partner_id the handler bound, across all queries. */
function boundPartnerIds(env) {
  const out = new Set();
  for (const c of env.calls) {
    for (const v of c.params || []) {
      if (typeof v === "string" && v.startsWith("p_")) out.add(v);
    }
  }
  return [...out];
}

console.log("staff-mailing — a partner's lists, and the wall around them\n");

/* ------------------------------- isolation ------------------------------- */

await check("a request naming ANOTHER partner is still scoped to the caller's", async () => {
  const env = envWith("staff");
  /* The request tries every way a caller might name somebody else. */
  const res = await handler.fetch(req("POST", {
    body: { partner_id: "p_mira", partnerId: "p_mira", scope: "p_mira",
            name: "Sneaky", from_name: "S", from_email: "s@x.one" },
  }), env);
  assert(res.status < 500, `unexpected ${res.status}`);
  const ids = boundPartnerIds(env);
  assert(!ids.includes("p_mira"),
    `the caller's partner id was taken from the REQUEST — bound ${JSON.stringify(ids)}`);
  assert(ids.includes("p_chase"), `expected p_chase to be the scope, bound ${JSON.stringify(ids)}`);
});

await check("reading a list belonging to somebody else is 404, not 403", async () => {
  /* 403 would confirm the list exists. The absence of a thing and the refusal
     to show it must look identical from outside. */
  const env = envWith("staff");
  env.DB.prepare = (sql) => {
    const run = async () => {
      if (/partner_users/i.test(sql)) return { results: [{ id: "p_chase", display_name: "Chase" }] };
      if (/FROM users/i.test(sql) && /email/i.test(sql)) {
        return { results: [{ user_id: "u_1", email: "chase@thauma.one",
                             user_name: "Chase", status: "active", roles: "staff" }] };
      }
      return { results: [] };            // the list is not theirs -> no row
    };
    return { bind() { return { all: run, run }; }, all: run, run };
  };
  const res = await handler.fetch(req("GET", { query: "?list=ml_belongs_to_mira" }), env);
  eq(res.status, 404, "status");
});

/* --------------------------- the organization ---------------------------- */

await check("staff cannot reach the organization's lists", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("GET", { query: "?scope=organization" }), env);
  eq(res.status, 403, "status");
  assert(/communications/i.test((await res.json()).error), "should name the role needed");
});

await check("communications CAN reach the organization's lists", async () => {
  const env = envWith("staff,communications");
  const res = await handler.fetch(req("GET", { query: "?scope=organization" }), env);
  eq(res.status, 200, "status");
  eq((await res.json()).scope, "organization", "scope");
});

await check("admin can too, and the console is told so", async () => {
  const env = envWith("admin,staff");
  const res = await handler.fetch(req("GET"), env);
  const body = await res.json();
  eq(body.may_send_as_organisation, true, "flag");
});

await check("a partner is NOT told they may send as the organization", async () => {
  const env = envWith("staff");
  const body = await (await handler.fetch(req("GET"), env)).json();
  eq(body.may_send_as_organisation, false, "flag");
});

/* An ambiguous request must resolve to the smaller scope, never the larger. */
await check("no scope means the caller's own lists, not the organization's", async () => {
  const env = envWith("admin,staff");
  const body = await (await handler.fetch(req("GET"), env)).json();
  eq(body.scope, "partner", "an unspecified scope must not widen to the organization");
});

await check("an account with no partner is refused, and told why", async () => {
  const env = envWith("staff", { partners: [] });
  const res = await handler.fetch(req("GET"), env);
  eq(res.status, 403, "status");
  assert(/not attached to a partner/i.test((await res.json()).error), "should explain");
});

/* ------------------------------ validation ------------------------------- */

await check("a list needs a name, a sender name and a sender address", async () => {
  eq(cleanList({}).error, "A list needs a name.", "no name");
  eq(cleanList({ name: "News" }).error,
    "A list needs a sender name — who the email is from.", "no sender name");
  assert(/sender address/.test(cleanList({ name: "News", from_name: "C" }).error),
    "no sender address");
});

await check("an address that cannot be an address is refused", async () => {
  assert(cleanList({ name: "N", from_name: "C", from_email: "not-an-address" }).error,
    "should refuse a bare word");
  assert(!cleanList({ name: "N", from_name: "C", from_email: "a@b.one" }).error,
    "should accept an ordinary address");
});

/* ---------------------- the sender is a picker ---------------------------
   Resend verifies domains, not addresses, so every address at a verified
   domain sends — including a typo, which leaves successfully and drops every
   reply into nothing. The field is a list an administrator maintains, and a
   list enforced only in the browser is not enforced. */

const ALLOWED = ["news@chase-roush.thauma.one", "prayer@chase-roush.thauma.one"];
const list = (from_email) => ({ name: "N", from_name: "C", from_email });

await check("a sender outside the allowed list is refused", async () => {
  const r = cleanList(list("nesw@chase-roush.thauma.one"), null, ALLOWED);
  assert(r.error, "a plausible typo was accepted");
  assert(/not one of the addresses/.test(r.error), `unhelpful: ${r.error}`);
});

await check("an allowed sender passes, whatever its case", async () => {
  assert(!cleanList(list("news@chase-roush.thauma.one"), null, ALLOWED).error, "exact");
  assert(!cleanList(list("News@Chase-Roush.Thauma.One"), null, ALLOWED).error,
    "addresses are not case-sensitive and a picker must not pretend otherwise");
});

await check("another partner's address is refused even though it is real", async () => {
  assert(cleanList(list("news@mira.thauma.one"), null, ALLOWED).error,
    "an address belonging to somebody else must not be selectable");
});

await check("NO addresses set up yet does not make every list unsaveable", async () => {
  /* The guard exists to stop typos, not to hold work hostage to an
     administrator. Lists created before senders existed still hold addresses
     that were valid when they were typed. */
  assert(!cleanList(list("anything@thauma.one"), null, []).error, "empty list");
  assert(!cleanList(list("anything@thauma.one"), null, undefined).error, "not supplied");
});

await check("a slug is derived when absent, and folded not stripped", async () => {
  eq(cleanList({ name: "Prayer Partners", from_name: "C", from_email: "a@b.one" }).value.slug,
    "prayer-partners", "derived");
  eq(slugify("Molitveni Partneri"), "molitveni-partneri", "plain");
  eq(slugify("Мира"), null, "a name with nothing latin in it yields no slug");
});

await check("is_open defaults OFF — a list is not publicly joinable by accident", async () => {
  eq(cleanList({ name: "N", from_name: "C", from_email: "a@b.one" }).value.is_open, 0, "default");
  eq(cleanList({ name: "N", from_name: "C", from_email: "a@b.one", is_open: true }).value.is_open,
    1, "when asked for");
});

await check("a status the console does not offer is refused", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("POST", {
    body: { action: "subscriber", id: "s_1", status: "subscribed_secretly" },
  }), env);
  eq(res.status, 400, "status");
});

/* ONE DATABASE, TWO PEOPLE (lib/fresh.js): a list's settings or a draft
   saved by someone else since this console opened it is not overwritten. */
function stubbed(rows) {
  const env = envWith("staff");
  const orig = env.DB.prepare;
  const ran = [];
  /* db.js hands D1 positional `?`, not the :names in queries.sql */
  const as = (n) => QUERIES[n].replace(/:([a-z_]+)/g, "?");
  env.DB.prepare = (sql) => {
    const name = Object.keys(rows).find((n) => as(n) === sql) ||
      ["mailing_list_upsert", "mailing_upsert", "contact_form_save", "contact_form_save_org"].find((n) => as(n) === sql);
    if (!name) return orig(sql);
    const run = async () => { ran.push(name); return { results: rows[name] || [] }; };
    return { bind() { return { all: run, run }; }, all: run, run };
  };
  return { env, ran };
}

await check("list settings saved by someone else meanwhile are not overwritten", async () => {
  const { env, ran } = stubbed({ mailing_list_one: [{ id: "ml_1", slug: "news", name: "Theirs", updated_at: "2026-09-30T10:00:00.000Z" }] });
  const res = await handler.fetch(req("POST", { body: { id: "ml_1", name: "Mine", updated_at: "2026-09-29T08:00:00.000Z" } }), env);
  const body = await res.json();
  eq([res.status, body.changed, body.current && body.current.name], [409, true, "Theirs"], "refused, with theirs " + JSON.stringify(body));
  assert(!ran.includes("mailing_list_upsert"), "written anyway");
});

await check("a draft saved by someone else meanwhile is not overwritten — compared by what was stored", async () => {
  const stored = { id: "mg_1", list_id: "ml_1", status: "draft", subject: "Theirs", preheader: null, body_html: "<p>Hi</p>" };
  const rows = { mailing_list_one: [{ id: "ml_1", slug: "news", name: "News" }], mailing_one: [stored] };
  let { env, ran } = stubbed(rows);
  let res = await handler.fetch(req("POST", { body: { action: "mailing-save", id: "mg_1", list_id: "ml_1",
    subject: "Mine", body_html: "<p>Mine</p>", base: { subject: "Before", preheader: null, body_html: "<p>Hi</p>" } } }), env);
  const b1 = await res.json();
  eq([res.status, b1.changed], [409, true], "refused " + JSON.stringify(b1) + " ran " + ran);
  assert(!ran.includes("mailing_upsert"), "written anyway");
  ({ env, ran } = stubbed(rows));
  await handler.fetch(req("POST", { body: { action: "mailing-save", id: "mg_1", list_id: "ml_1",
    subject: "Mine", body_html: "<p>Mine</p>", base: { subject: "Theirs", preheader: null, body_html: "<p>Hi</p>" } } }), env);
  assert(ran.includes("mailing_upsert"), "unchanged since it opened — it must save");
});

/* Leaving the composer saves (Chase, 2026-10-03: drafts are deleted only by
   hand). Words written before a subject is chosen are kept; Send and Test
   still refuse a mailing without one (buildMailing). */
await check("a draft with words and no subject yet is saved", async () => {
  const rows = { mailing_list_one: [{ id: "ml_1", slug: "news", name: "News" }],
                 mailing_one: [{ id: "mg_1", list_id: "ml_1", status: "draft", subject: "", body_html: "<p>Words</p>" }] };
  const { env, ran } = stubbed(rows);
  const res = await handler.fetch(req("POST", { body: { action: "mailing-save", list_id: "ml_1",
    subject: "", body_html: "<p>Words first</p>" } }), env);
  eq(res.status, 200, "status");
  assert(ran.includes("mailing_upsert"), "not written");
});

await check("a draft with nothing in it at all is refused, not stored", async () => {
  const { env, ran } = stubbed({ mailing_list_one: [{ id: "ml_1", slug: "news", name: "News" }] });
  const res = await handler.fetch(req("POST", { body: { action: "mailing-save", list_id: "ml_1",
    subject: "  ", body_html: "<p></p>" } }), env);
  eq(res.status, 400, "status");
  assert(!ran.includes("mailing_upsert"), "an empty draft was written");
});

await check("a draft's save can move it to another list, and only ever touches the caller's own", () => {
  const sql = QUERIES.mailing_upsert;
  assert(/list_id\s*=\s*excluded\.list_id/.test(sql), "the list does not move with Sending to");
  assert(/mailings\.partner_id IS excluded\.partner_id/.test(sql),
    "an id from another ministry would be overwritten before the read-back refused it");
});

await check("Mail's lists carry their drafts, for the Drafts card", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("GET"), env);
  const body = await res.json();
  assert(Array.isArray(body.lists) && body.lists.length, "no lists");
  assert(Array.isArray(body.lists[0].draft_rows), "a list has no draft_rows");
  assert(env.calls.some((c) => c.sql === QUERIES.mailings_drafts_for_list.replace(/:[a-z_][a-z0-9_]*/gi, "?")),
    "mailings_drafts_for_list was not asked");
});

await check("the contact form's settings saved by someone else meanwhile are not overwritten", async () => {
  const rows = { contact_form_for_partner: [{ deliver_to: "theirs@thauma.one", is_open: 1, updated_at: "2026-09-30T10:00:00.000Z" }] };
  let { env, ran } = stubbed(rows);
  const res = await handler.fetch(req("POST", { body: { action: "contact-form", deliver_to: "mine@thauma.one",
    updated_at: "2026-09-29T08:00:00.000Z" } }), env);
  const body = await res.json();
  eq([res.status, body.changed, body.current && body.current.deliver_to], [409, true, "theirs@thauma.one"], "refused, with theirs");
  assert(!ran.some((n) => n.startsWith("contact_form_save")), "written anyway");
  ({ env, ran } = stubbed(rows));
  await handler.fetch(req("POST", { body: { action: "contact-form", deliver_to: "mine@thauma.one",
    updated_at: "2026-09-30T10:00:00.000Z" } }), env);
  assert(ran.some((n) => n.startsWith("contact_form_save")), "saved as opened");
});

await check("adding by hand is refused an address that cannot be one", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("POST", {
    body: { action: "add-subscriber", list_id: "ml_1", email: "not-an-address" },
  }), env);
  eq(res.status, 400, "status");
});

await check("adding by hand needs a list that is yours", async () => {
  /* mailing_list_one returns nothing for a list belonging to somebody else,
     which is how this becomes 404 rather than a write into their list. */
  const env = envWith("staff");
  const orig = env.DB.prepare;
  env.DB.prepare = (sql) => {
    if (/FROM mailing_lists/i.test(sql)) {
      const run = async () => ({ results: [] });
      return { bind() { return { all: run, run }; }, all: run, run };
    }
    return orig(sql);
  };
  const res = await handler.fetch(req("POST", {
    body: { action: "add-subscriber", list_id: "ml_not_mine", email: "a@b.one" },
  }), env);
  eq(res.status, 404, "status");
});

/* `pending` means "asked and has not confirmed". Setting it BY HAND would be
   the console asserting somebody never agreed, which is not its claim to
   make — so it is absent from the statuses a picker may send. */
await check("the console cannot mark somebody back to unconfirmed", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("POST", {
    body: { action: "subscriber", id: "s_1", status: "pending" },
  }), env);
  eq(res.status, 400, "status");
});

await check("a bounced address can be set back to subscribed", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("POST", {
    body: { action: "subscriber", id: "s_1", status: "subscribed" },
  }), env);
  eq(res.status, 200, "an address that starts working again must have a way back");
});

await check("only GET, POST, DELETE, and PUT for an attachment are allowed", async () => {
  /* PUT was in this list until 2026-10-03, which is how the attachment
     button's "Method not allowed" passed every test. */
  const res = await handler.fetch(req("PATCH", { body: {} }), envWith("staff"));
  eq(res.status, 405, "PATCH status");
  const put = await handler.fetch(req("PUT", { body: {} }), envWith("staff"));
  eq(put.status, 400, "PUT with nothing to attach");
});

/* --------------------- a bigger subscriber list ------------------------ */

await check("the sort is decided by the QUERY, never spliced into it", () => {
  /* A sort order arriving from a browser and being interpolated into SQL is
     the classic injection, and the classic mitigation — an allow-list in the
     Worker — has to be got right in every caller forever. The CASE inside the
     query means the value is bound like any other, and an unrecognized one
     falls through to the default rather than being an error or a hole. */
  const sql = QUERIES.subscribers_for_list;
  assert(/CASE WHEN :sort =/.test(sql), "the sort is not chosen by a bound parameter");
  assert(/ORDER BY[\s\S]*s\.subscribed_at DESC\s*$/m.test(sql.trim().replace(/LIMIT[\s\S]*$/, "")),
    "there must be a final fixed sort, or two equal rows swap places between pages");
});

await check("LIKE carries an ESCAPE clause", () => {
  /* The Worker backslash-escapes % and _ so a name containing one is searched
     for literally. Without ESCAPE, SQLite does not know what the backslash
     means — so the escaping stops the wildcard AND stops the match, and
     searching "50%" finds nobody at all. */
  for (const q of ["subscribers_for_list", "subscribers_for_list_count"]) {
    const likes = (QUERIES[q].match(/LIKE :like/g) || []).length;
    const escapes = (QUERIES[q].match(/LIKE :like ESCAPE/g) || []).length;
    eq(escapes, likes, `${q} has ${likes} LIKE clauses but ${escapes} with ESCAPE`);
    /* AND THE BACKSLASH MUST SURVIVE GENERATION. The SQL is emitted inside a
       JavaScript template literal, where a backslash escapes the next
       character — so an ESCAPE clause reached the Worker with its escape
       character gone. The query still ran and still returned rows; it just
       quietly stopped matching anything containing a literal % or _.

       Built from a character code rather than written as a literal, because
       "how many backslashes" is the question this test exists to answer and
       asking it again in the test itself is how the first version of it
       failed. */
    const BS = String.fromCharCode(92);
    assert(QUERIES[q].includes("ESCAPE '" + BS + "'"),
      `${q}'s escape character was eaten in generation: ` +
      JSON.stringify((QUERIES[q].match(/ESCAPE .{0,4}/) || [])[0]));
  }
});

await check("the count filters exactly as the list does", () => {
  // A count that disagrees with its list is worse than no count: it tells
  // somebody there is another page and then shows them nothing.
  /* lastIndexOf, because subscribers_for_list has a WHERE inside its tags
     subquery before the real one. */
  const clause = (sql) => sql.slice(sql.lastIndexOf("WHERE"),
    sql.indexOf("ORDER BY") > -1 ? sql.indexOf("ORDER BY") : sql.length)
    .replace(/\s+/g, " ").trim().replace(/;$/, "");
  eq(clause(QUERIES.subscribers_for_list_count), clause(QUERIES.subscribers_for_list),
    "the two WHERE clauses have drifted apart");
});

await check("CHANGING AN ADDRESS SENDS THE ROW BACK TO UNCONFIRMED", () => {
  /* This is the consent model, not caution. Without it, editing a confirmed
     subscriber's address is a way to subscribe ANY address without that person
     agreeing — from a console screen labeled "edit". */
  const sql = QUERIES.subscriber_change_email;
  assert(/status = 'pending'/.test(sql), "the row must go back to pending");
  assert(/confirmed_at = NULL/.test(sql), "and lose its confirmation date");
  assert(/confirm_token = :token/.test(sql), "and get a fresh token to confirm with");
});

await check("changing only a NAME does not touch consent", () => {
  // A name is a label, not something anybody agreed to.
  const sql = QUERIES.subscriber_set_name;
  assert(!/status/.test(sql), "renaming somebody must not change their status");
  assert(!/confirm/.test(sql), "nor ask them to confirm anything");
});

await check("reading one subscriber is scoped through its list", () => {
  // Knowing an id must not be enough to read somebody else's subscriber.
  assert(/JOIN mailing_lists/.test(QUERIES.subscriber_one), "not joined to its list");
  assert(/l\.partner_id IS :partner_id/.test(QUERIES.subscriber_one),
    "not scoped to the caller's partner");
});

await check("AN ABSENT FILTER IS AN EMPTY STRING, NEVER NULL", async () => {
  /* The query asks `:status = ''` to mean "no filter". clean() returns NULL
     for an absent value, and in SQL `NULL = ''` is not FALSE — it is NULL. The
     whole OR collapses to NULL, every row fails the test, and the list comes
     back EMPTY while the counts above it still show the right totals.

     That is precisely how it looked on screen: three subscribed, three
     unconfirmed, one unsubscribed, and not a single row. */
  const bound = [];
  const env = {
    ACCESS_TEAM_DOMAIN: "t", ACCESS_AUD: "a",
    DB: { prepare(sql) {
      return { bind(...a) { if (/FROM subscribers/i.test(sql)) bound.push({ sql, a });
                            return { all: async () => ({ results: [] }),
                                     run: async () => ({ results: [] }) }; },
               all: async () => ({ results: [] }) };
    } },
  };
  // Reaching the query needs a session; the binder is what is under test, so
  // it is exercised directly with what the handler computes.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/staff-mailing.js", import.meta.url), "utf8"));
  const clean = new Function("return " + src.match(/function clean\([\s\S]*?\n}/)[0])();

  for (const raw of [null, undefined, ""]) {
    const v = clean(raw, 20) || "";
    eq(v, "", `clean(${JSON.stringify(raw)}) must become an empty string, not ${JSON.stringify(clean(raw, 20))}`);
  }

  /* And the query has to actually treat '' as "everything". */
  assert(/:status = '' OR/.test(QUERIES.subscribers_for_list),
    "the no-filter case must be an explicit empty-string test");
  assert(/:q = '' OR/.test(QUERIES.subscribers_for_list),
    "same for the search");
});

/* ---- a form's own words, every language (0039) ---- */

const LANGS = [{ code: "en", is_active: 1 }, { code: "hr", is_active: 1 }];
const byName = (env, name) => env.calls.filter((c) => c.sql === QUERIES[name].replace(/:[a-z_][a-z0-9_]*/gi, "?"));

await check("a form's words are written whole: languages with words, and only those", async () => {
  const env = envWith("staff", { languages: LANGS });
  const res = await handler.fetch(req("POST", { body: { action: "form-words", form: "contact",
    words: { en: { heading: "Write to us", thanks: "Thank you." }, hr: { heading: "", blurb: "" } } } }), env);
  eq(res.status, 200, "status");
  eq(byName(env, "form_words_clear").length, 1, "cleared first");
  const ins = byName(env, "form_word_insert");
  eq(ins.length, 1, "only English had words");
  assert(ins[0].params.includes("Write to us") && ins[0].params.includes("Thank you."), JSON.stringify(ins[0].params));
  assert(ins[0].params.includes("p_chase"), "written for this ministry");
});

await check("a language Thauma does not offer is refused", async () => {
  const env = envWith("staff", { languages: LANGS });
  const res = await handler.fetch(req("POST", { body: { action: "form-words", form: "signup",
    words: { xx: { heading: "?" } } } }), env);
  eq(res.status, 400, "status");
  eq(byName(env, "form_word_insert").length, 0, "nothing written");
});

await check("the sign-up form keeps no after-sending words (the contact form does)", async () => {
  const env = envWith("staff", { languages: LANGS });
  await handler.fetch(req("POST", { body: { action: "form-words", form: "signup",
    words: { en: { heading: "Join", thanks: "ignored" } } } }), env);
  const ins = byName(env, "form_word_insert");
  assert(!ins[0].params.includes("ignored"), "thanks stored on the sign-up form");
});

/* ------------------------- a send that breaks --------------------------- */

/* The live site, 2026-10: two mailings crashed after the claim, stayed at
   'sending' forever, and the console said only "(500)". */
function crashingSendEnv({ crash = true, roles = "staff" } = {}) {
  const env = envWith(roles);
  env.SIGNUP_SALT = "s".repeat(32);
  const sqlOf = (name) => QUERIES[name].replace(/:[a-z_][a-z0-9_]*/gi, "?");
  let status = "draft";
  const inner = env.DB.prepare;
  env.DB.prepare = (sql) => {
    const answer = async () => {
      if (sql === sqlOf("mailing_start")) { status = "sending"; return { results: [] }; }
      if (sql === sqlOf("mailing_unstart")) { status = "draft"; return { results: [] }; }
      if (sql === sqlOf("mailing_one")) {
        return { results: [{ id: "mg_1", list_id: "ml_1", partner_id: "p_chase", status,
                             subject: "Hello", body_html: "<p>Hi</p>", body_text: "Hi" }] };
      }
      if (sql === sqlOf("subscribers_to_send_count")) return { results: [{ n: 1 }] };
      if (sql === sqlOf("subscribers_to_send")) {
        return { results: [{ id: "sb_1", email: "a@b.one", name: "A" }] };
      }
      if (crash && sql === sqlOf("partner_settings")) throw new Error("boom in partner_settings");
      return null;
    };
    const stmt = inner(sql);
    const run = async () => {
      const mine = await answer();
      if (!mine) return stmt.all();             // the inner mock records it
      env.calls.push({ sql, params: env._lastParams });
      return mine;
    };
    return { bind(...args) { env._lastParams = args; return { all: run, run }; }, all: run, run };
  };
  return { env, status: () => status };
}

await check("a send that breaks before anything left goes back to draft, and says why", async () => {
  const { env, status } = crashingSendEnv();
  const res = await handler.fetch(req("POST", { body: { action: "mailing-send", id: "mg_1" } }), env);
  eq(res.status, 500, "status");
  const body = await res.json();
  assert(/boom in partner_settings/.test(body.error || ""), `error should name the cause, got ${JSON.stringify(body)}`);
  eq(status(), "draft", "mailing status after the crash");
  eq(byName(env, "mailing_recipients_clear_pending").length, 1, "pending rows cleared");
});

/* The 500 itself (2026-08-24 → 10-03): buildMailing answers { value }, and
   both buttons read the message off the wrapper — so the body was undefined
   and render() threw. The mocks above never reached a real render. */
async function sendsThrough(action) {
  const { env } = crashingSendEnv({ crash: false });
  env.RESEND_API_KEY = "re_test";
  const out = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) {
      out.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }
    return before(url, init);
  };
  try {
    const res = await handler.fetch(req("POST", { body: { action, id: "mg_1" } }), env);
    return { res, out, env };
  } finally { globalThis.fetch = before; }
}

await check("Send me a test delivers the mailing's own subject and words", async () => {
  const { res, out } = await sendsThrough("mailing-test");
  eq(res.status, 200, "status");
  eq(out.length, 1, "messages handed to Resend");
  eq(out[0].subject, "[TEST] Hello", "subject");
  assert(out[0].html.includes("Hi"), "the body is missing from the html");
  assert(!/undefined/.test(out[0].html + out[0].text), "undefined in the message");
});

await check("Send delivers it, and the mailing gets a slug from its subject", async () => {
  const { res, out, env } = await sendsThrough("mailing-send");
  eq(res.status, 200, "status");
  eq(out.length, 1, "messages handed to Resend");
  eq(out[0].subject, "Hello", "subject");
  const start = byName(env, "mailing_start");
  assert(start.length === 1 && start[0].params.includes("hello"),
    `slug should be "hello", bound ${JSON.stringify(start.map((c) => c.params))}`);
});

/* ---- attachments (2026-10-03: the button answered "Method not allowed") ---- */

function attachEnv(roles = "staff") {
  const { env } = crashingSendEnv({ crash: false, roles });
  const bucket = new Map();
  env.MEDIA = {
    async put(key, bytes, opts) { bucket.set(key, { bytes, opts }); },
    async head(key) { const o = bucket.get(key); return o ? { size: o.bytes.length } : null; },
    async get() { return null; },
  };
  return { env, bucket };
}
const upload = (env, name, bytes, query = "") => handler.fetch(new Request(
  `https://x/api/staff-mailing?${query}attach=${encodeURIComponent(name)}`, {
    method: "PUT", body: bytes,
    headers: { "Content-Type": "application/octet-stream", "Cf-Access-Jwt-Assertion": TOKEN },
  }), env);
const saveWith = (env, attachments) => handler.fetch(req("POST", { body: {
  action: "mailing-save", id: "mg_1", list_id: "ml_1", subject: "Hello",
  body_html: "<p>Hi</p>", attachments } }), env);

await check("an attachment uploads into the caller's own folder and comes back in the draft's shape", async () => {
  const { env, bucket } = attachEnv();
  const res = await upload(env, "Prayer letter.pdf", new Uint8Array([37, 80, 68, 70]));
  eq(res.status, 200, "status");
  const { file } = await res.json();
  assert(/^attachments\/p_chase\/[0-9a-f]{16}-Prayer-letter\.pdf$/.test(file.object_key),
    `key ${file.object_key}`);
  eq([file.filename, file.content_type, file.bytes], ["Prayer letter.pdf", "application/pdf", 4], "fields");
  assert(bucket.has(file.object_key), "not stored");
});

await check("a file type mail filters distrust is refused before it is stored", async () => {
  const { env, bucket } = attachEnv();
  for (const name of ["setup.exe", "page.html", "photos.zip", "noextension"]) {
    const res = await upload(env, name, new Uint8Array([1]));
    eq(res.status, 415, name);
  }
  eq(bucket.size, 0, "nothing stored");
});

await check("a file over 5MB is refused", async () => {
  const { env, bucket } = attachEnv();
  const res = await upload(env, "big.pdf", new Uint8Array(5 * 1024 * 1024 + 1));
  eq(res.status, 413, "status");
  eq(bucket.size, 0, "nothing stored");
});

await check("saving keeps only keys from the caller's own folder, sized by the bucket", async () => {
  const { env } = attachEnv();
  const { file } = await (await upload(env, "a.pdf", new Uint8Array(1000))).json();
  const res = await saveWith(env, [
    { ...file, bytes: 1 },                                     // the page lies about the size
    { object_key: "attachments/p_mira/aaaa-theirs.pdf", filename: "theirs.pdf", bytes: 5 },
    { object_key: "attachments/p_chase/never-uploaded.pdf", filename: "ghost.pdf", bytes: 5 },
  ]);
  eq(res.status, 200, "status");
  const added = byName(env, "mailing_attachment_add");
  eq(added.length, 1, "attachments recorded");
  assert(added[0].params.includes(file.object_key), "own file missing");
  assert(added[0].params.includes(1000), "size should come from the bucket");
});

await check("a mailing over 10MB of attachments is refused and keeps what it had", async () => {
  const { env } = attachEnv();
  const files = [];
  for (let i = 0; i < 3; i++) {
    files.push((await (await upload(env, `f${i}.pdf`, new Uint8Array(4 * 1024 * 1024))).json()).file);
  }
  const res = await saveWith(env, files);
  eq(res.status, 413, "status");
  eq(byName(env, "mailing_attachment_clear").length, 0, "the old list was cleared anyway");
});

await check("one of Thauma's own lists attaches into the organization's folder", async () => {
  /* The composer used to upload without the scope, so the file landed in the
     signed-in person's partner folder and the organization's save refused it. */
  const { env } = attachEnv("admin,staff");
  const res = await upload(env, "a.pdf", new Uint8Array([1]), "scope=organization&");
  eq(res.status, 200, "status");
  const { file } = await res.json();
  assert(file.object_key.startsWith("attachments/org/"), `key ${file.object_key}`);
});

await check("any other failure answers with its message, not a bare 500", async () => {
  const env = envWith("staff");
  const inner = env.DB.prepare;
  env.DB.prepare = (sql) => {
    if (/FROM mailing_lists/i.test(sql)) throw new Error("no such column: x");
    return inner(sql);
  };
  const res = await handler.fetch(req("GET"), env);
  eq(res.status, 500, "status");
  assert(/no such column: x/.test((await res.json()).error || ""), "message missing");
});

await check("a saved mailing records WHO wrote it", async () => {
  /* The actor carries the user at actor.me.user_id; actor.user_id does not
     exist, so every mailing was saved with created_by NULL until 2026-10-03. */
  const env = envWith("staff");
  await handler.fetch(req("POST", { body: { action: "mailing-save", list_id: "ml_1",
    subject: "Hi", body_html: "<p>x</p>" } }), env);
  const up = byName(env, "mailing_upsert");
  assert(up.length === 1 && up[0].params.includes("u_1"),
    `created_by should be u_1, bound ${JSON.stringify(up.map((c) => c.params))}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
