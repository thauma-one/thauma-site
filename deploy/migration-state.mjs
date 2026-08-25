#!/usr/bin/env node
/**
 * migration-state.mjs — is this database ready for the code about to ship?
 *
 *   node deploy/migration-state.mjs --database thauma-ops
 *   node deploy/migration-state.mjs --database thauma-ops-dev --apply
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * Migrations are applied per database, deploys ship per branch, and until now
 * NOTHING CONNECTED THE TWO. A deploy would happily push code whose queries
 * name columns the target database has never heard of. The result is not a
 * failed deploy — it is a successful one, followed by 500s on whichever screen
 * touches the new tables, with nothing anywhere saying why.
 *
 * That has already happened here once: production ran for weeks with 0009 and
 * 0010 unapplied, and removing a person returned a 500 with no clue as to the
 * cause. admin-migrate.js was written in response, and it made the gap
 * FIXABLE from the console. It did not make the gap IMPOSSIBLE TO SHIP, which
 * is what this adds.
 *
 * It is also why "the dev site says 22 migrations" is not reassuring. The Pi
 * runs `wrangler dev --local`, so dev.thauma.one reads a SQLite file on that
 * machine — not the `thauma-ops-dev` database in Cloudflare that staging uses,
 * despite the two sharing a name in wrangler.toml. Local can be twenty-two
 * migrations ahead of the database its own name points at.
 *
 * TWO DIFFERENT ANSWERS FOR TWO DIFFERENT ENVIRONMENTS
 * ---------------------------------------------------------------------------
 * STAGING APPLIES. Its whole job is to be what production is about to become,
 * so being behind is never useful — and a migration that fails belongs to
 * staging, which is the point of having one.
 *
 * PRODUCTION REFUSES. Applying a schema change to real data as a side effect
 * of pushing a branch is not a decision a merge should be able to make. The
 * deploy stops, names what is pending, and points at the console's Apply
 * button — where a person does it deliberately, and where the audit log
 * records who.
 *
 * WHY IT SHELLS OUT TO WRANGLER rather than using the D1 REST API: wrangler is
 * already installed, already authenticated in CI, and already the thing that
 * applies migrations by hand. One way of talking to the database is easier to
 * keep true than two.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "db/migrations";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const database = flag("--database");
const apply = args.includes("--apply");

if (!database) {
  console.error("usage: migration-state.mjs --database <name> [--apply]");
  process.exit(2);
}

/** Every migration in the repository, in the order they must run. */
function onDisk() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

function d1(sql) {
  const out = execFileSync("npx", [
    "wrangler", "d1", "execute", database, "--remote", "--json", "--command", sql,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  /* wrangler prints a banner before the JSON on some versions, so the parse
     starts at the first bracket rather than at the first byte. */
  const at = out.indexOf("[");
  if (at === -1) throw new Error(`no JSON in wrangler output:\n${out}`);
  return JSON.parse(out.slice(at));
}

/** What the database says has run. A database with no bookkeeping table has
    run nothing, which is the honest answer for a fresh one rather than a
    crash. */
function applied() {
  try {
    const res = d1("SELECT name FROM schema_migrations ORDER BY name");
    return new Set((res[0]?.results || []).map((r) => r.name));
  } catch (err) {
    if (/no such table/i.test(String(err.stdout || err.message))) return new Set();
    throw err;
  }
}

const files = onDisk();
const done = applied();
const pending = files.filter((f) => !done.has(f));

console.log(`  database : ${database}`);
console.log(`  in repo  : ${files.length}`);
console.log(`  applied  : ${done.size}`);

if (!pending.length) {
  console.log("  pending  : none — the schema is ready for this code");
  process.exit(0);
}

console.log(`  pending  : ${pending.length}`);
for (const p of pending) console.log(`             ${p}`);

if (!apply) {
  console.error(
    "\n  REFUSING TO DEPLOY.\n" +
    "  This code expects a schema the database does not have yet. Deploying\n" +
    "  anyway would succeed and then return 500s from whichever screen touches\n" +
    "  the new tables, with nothing saying why.\n\n" +
    "  Apply them first: Admin → Publish → Migrations, which records who did\n" +
    "  it and when. Then re-run this deploy.\n");
  process.exit(1);
}

/* --apply, for staging only. Each file goes in on its own and is recorded
   before the next one starts, so a failure half way leaves an accurate record
   of how far it got rather than an all-or-nothing guess. */
for (const name of pending) {
  console.log(`\n  applying ${name}`);
  const path = join(MIGRATIONS, name);
  try {
    execFileSync("npx", [
      "wrangler", "d1", "execute", database, "--remote", "--file", path,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    console.error(`\n  ${name} FAILED. Nothing after it has been attempted.`);
    console.error(String(err.stdout || err.message).split("\n").slice(-12).join("\n"));
    process.exit(1);
  }

  /* The same bookkeeping row admin-migrate.js writes, so a migration applied
     here and one applied from the console are indistinguishable afterwards —
     otherwise the console would offer to re-run what CI already did. */
  const statements = readFileSync(path, "utf8").split(";").filter((x) => x.trim()).length;
  d1(
    "INSERT INTO schema_migrations (name, applied_at, applied_by, statements, baselined) " +
    `VALUES ('${name}', '${new Date().toISOString()}', 'deploy', ${statements}, 0)`
  );
  console.log(`  recorded ${name}`);
}

console.log(`\n  applied ${pending.length} migration(s) to ${database}`);
