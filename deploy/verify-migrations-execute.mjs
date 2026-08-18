#!/usr/bin/env node
/**
 * verify-migrations-execute.mjs — do the SPLIT statements actually run?
 *
 *   node deploy/verify-migrations-execute.mjs
 *
 * WHY THIS IS SEPARATE FROM THE TEST SUITE
 * ---------------------------------------------------------------------------
 * sqlsplit.test.mjs proves the splitter cuts the files where it should. It
 * cannot prove the pieces are valid SQLite, because there is no SQLite in the
 * test environment — Node 20 has no node:sqlite and nothing here bundles one.
 *
 * Rejoining the statements and running the file would prove nothing: a trigger
 * split in half rejoins into exactly the valid file it came from. The only
 * honest check is to execute each statement ON ITS OWN, which is what the
 * migration runner does in production.
 *
 * So this walks every migration, splits it, and feeds each statement to a real
 * SQLite through wrangler's local D1 — in order, against a database that
 * starts empty. It takes a few minutes and is not part of `npm test`.
 *
 * It writes to its own --persist-to directory, so a developer's local data is
 * not touched.
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements } from "../workers/src/lib/sqlsplit.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, "db/migrations");
const STATE = mkdtempSync(join(tmpdir(), "thauma-migrate-verify-"));
const SQL = join(STATE, "stmt.sql");

const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
console.log(`Verifying ${files.length} migrations against a fresh local D1.`);
console.log(`State: ${STATE}\n`);

let ran = 0;
const failures = [];

for (const f of files) {
  const statements = splitStatements(readFileSync(join(DIR, f), "utf8"));
  process.stdout.write(`  ${f.padEnd(42)} ${String(statements.length).padStart(3)} statements  `);

  let ok = 0;
  for (const { sql, line } of statements) {
    writeFileSync(SQL, sql);
    try {
      execFileSync("npx", [
        /* The BINDING, not a database name. Local mode resolves it from the
           default environment in wrangler.toml, and the binding is the one
           name that is the same in every environment. */
        "wrangler", "d1", "execute", "DB",
        "--local", "--persist-to", STATE, "--file", SQL,
      ], { cwd: ROOT, stdio: "pipe", timeout: 120000 });
      ok++;
      ran++;
    } catch (err) {
      const out = `${err.stdout || ""}${err.stderr || ""}`;
      failures.push({
        file: f, line,
        statement: sql.split("\n")[0].slice(0, 90),
        error: (out.match(/Error:.*/) || [out.slice(0, 200)])[0],
      });
      break;   // the rest of this file depends on this statement
    }
  }
  console.log(ok === statements.length ? "OK" : `FAILED after ${ok}`);
  if (ok !== statements.length) break;   // later migrations depend on this one
}

console.log();
if (failures.length) {
  console.log(`${ran} statements executed, then:`);
  for (const x of failures) {
    console.log(`\n  ${x.file} line ${x.line}`);
    console.log(`    ${x.statement}`);
    console.log(`    ${x.error}`);
  }
} else {
  console.log(`All ${ran} statements executed against real SQLite, in order.`);
  console.log("The splitter's output is what the migration runner can safely run.");
}

rmSync(STATE, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
