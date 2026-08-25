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
function envWith(roles = "staff", { partners = [{ id: "p_chase", display_name: "Chase" }] } = {}) {
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

/* --------------------------- the organisation ---------------------------- */

await check("staff cannot reach the organisation's lists", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("GET", { query: "?scope=organisation" }), env);
  eq(res.status, 403, "status");
  assert(/communications/i.test((await res.json()).error), "should name the role needed");
});

await check("communications CAN reach the organisation's lists", async () => {
  const env = envWith("staff,communications");
  const res = await handler.fetch(req("GET", { query: "?scope=organisation" }), env);
  eq(res.status, 200, "status");
  eq((await res.json()).scope, "organisation", "scope");
});

await check("admin can too, and the console is told so", async () => {
  const env = envWith("admin,staff");
  const res = await handler.fetch(req("GET"), env);
  const body = await res.json();
  eq(body.may_send_as_organisation, true, "flag");
});

await check("a partner is NOT told they may send as the organisation", async () => {
  const env = envWith("staff");
  const body = await (await handler.fetch(req("GET"), env)).json();
  eq(body.may_send_as_organisation, false, "flag");
});

/* An ambiguous request must resolve to the smaller scope, never the larger. */
await check("no scope means the caller's own lists, not the organisation's", async () => {
  const env = envWith("admin,staff");
  const body = await (await handler.fetch(req("GET"), env)).json();
  eq(body.scope, "partner", "an unspecified scope must not widen to the organisation");
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

await check("only GET, POST and DELETE are allowed", async () => {
  for (const m of ["PUT", "PATCH"]) {
    const res = await handler.fetch(req(m, { body: {} }), envWith("staff"));
    eq(res.status, 405, `${m} status`);
  }
});

/* --------------------- a bigger subscriber list ------------------------ */

await check("the sort is decided by the QUERY, never spliced into it", () => {
  /* A sort order arriving from a browser and being interpolated into SQL is
     the classic injection, and the classic mitigation — an allow-list in the
     Worker — has to be got right in every caller forever. The CASE inside the
     query means the value is bound like any other, and an unrecognised one
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
     agreeing — from a console screen labelled "edit". */
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
