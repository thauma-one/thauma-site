/**
 * dbsync.js — moving ROWS between this deployment's database and another
 *
 * WHY THIS IS NOT A SHELL SCRIPT
 * ---------------------------------------------------------------------------
 * There are two python scripts that do this from a terminal. They work, and
 * they are the wrong shape: the person who needs them does not write scripts,
 * and a capability that only exists behind a command line is one that only
 * exists for whoever wrote it. So the same job lives here, behind a button.
 *
 * A Worker cannot run a shell — but it does not need one. Every side of this
 * is reachable from inside a Worker: the local database through its own D1
 * binding, the far one through D1's HTTP API.
 *
 * EVERYTHING BELOW IS PURE. No fetch, no bindings, no environment. It takes
 * rows and gives back statements, so the ordering and the scrubbing can be
 * tested without a database on either end — which is what the shell versions
 * could not do, and why three of their bugs only appeared when run.
 */

/** Rows that describe a deployment rather than its content. */
export const SKIP_TABLES = new Set([
  "schema_migrations",
  /* Append-only by trigger: trg_audit_no_delete refuses the DELETE a replace
     needs. Skipped rather than worked around — an audit log is the record of
     what happened on THAT deployment, and overwriting one with another's
     would make it a fiction. */
  "audit_log",
  /* Somebody's signed-in session. Copying it hands the other side a live
     credential for a browser that is not theirs. */
  "sessions",
]);

/** Columns holding somebody's personal data, per table. */
export const SCRUB = {
  contacts: ["first_name", "last_name", "email", "phone",
             "address_1", "address_2", "city", "postal_code", "notes"],
  interactions: ["note"],
  subscribers: ["email", "name", "confirm_token"],
  mailing_recipients: ["email"],
  signup_attempts: ["ip_hash"],
};

/** Where somebody else's address can be. */
export const ADDRESS_COLUMNS = {
  subscribers: "email", contacts: "email", mailing_recipients: "email",
};

/**
 * Is this address obviously not a real person's?
 *
 * RFC 2606 reserves .invalid, .test, .example and the example.* domains for
 * exactly this. `example` is matched as the SECOND-TO-LAST label so that
 * example.com, example.hr and sub.example.org all pass while
 * example.com.evil.net does not — a domain registered to look reserved is not.
 */
export function invented(address) {
  const domain = String(address || "").split("@").pop().trim().toLowerCase()
    .replace(/\.$/, "");
  const labels = domain.split(".");
  if (labels.length >= 2 && labels[labels.length - 2] === "example") return true;
  return /\.(invalid|test|example|localhost)$/.test(domain)
    || ["localhost", "invalid", "test", "example"].includes(domain);
}

/** Tables whose ROWS are ours to move. Underscore-prefixed names are
    Cloudflare's own bookkeeping inside the D1 file and belong to neither
    side. */
export function copyableTables(names) {
  return names
    .filter((n) => !n.startsWith("sqlite_") && !n.startsWith("_") && !SKIP_TABLES.has(n))
    .sort();
}

/**
 * Tables ordered so a row's parents exist before it does.
 *
 * NOT ALPHABETICAL. Foreign keys can be deferred, but TRIGGERS cannot, and
 * several read across tables — mtx_partner_match reads the milestone a
 * translation belongs to, directory_owner_has_partner reads partner_users
 * which is not even a foreign key. Alphabetically milestone_translations sorts
 * before milestones, so the obvious order fails on the first real dataset.
 *
 * `deps` maps table -> Set of tables it needs first, built by the caller from
 * PRAGMA foreign_key_list plus the text of each trigger.
 */
export function loadOrder(tables, deps) {
  const out = [];
  const left = new Map(tables.map((t) => [t, new Set(deps.get(t) || [])]));
  while (left.size) {
    const ready = [...left.keys()]
      .filter((t) => [...left.get(t)].every((d) => !left.has(d) || d === t))
      .sort();
    if (!ready.length) {
      /* A cycle, or a dependency outside this set. Emit the rest in a stable
         order rather than looping; whatever could not be satisfied shows up as
         a foreign key complaint at the end, which is a better failure than a
         hang. */
      out.push(...[...left.keys()].sort());
      break;
    }
    for (const t of ready) { out.push(t); left.delete(t); }
  }
  return out;
}

/** Deterministic stand-ins, so two runs produce the same data. */
export function fake(col, i) {
  switch (col) {
    case "first_name": return ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan"][i % 6];
    case "last_name": return ["Doe", "Roe", "Poe", "Loe", "Moe", "Noe"][i % 6];
    case "name": return `Person ${i}`;
    case "email": return `user${i}@example.invalid`;
    case "phone": return `+1 555 01${String(i % 100).padStart(2, "0")}`;
    case "city": return "Anytown";
    case "notes": return "[scrubbed] stewardship note";
    case "note": return "[scrubbed] interaction note";
    case "ip_hash": return "0".repeat(32);
    default: return null;
  }
}

/**
 * Addresses in `rowsByTable` that are somebody's rather than invented.
 * Returned so a caller can refuse, and so a person can be told which table.
 */
export function realAddresses(rowsByTable) {
  const found = [];
  for (const [table, col] of Object.entries(ADDRESS_COLUMNS)) {
    for (const row of rowsByTable[table] || []) {
      const v = row[col];
      if (v && !invented(v)) found.push({ table, address: String(v) });
    }
  }
  return found;
}

/**
 * The whole transfer as parameterised statements.
 *
 * PARAMETERISED, not interpolated. The rows being moved include free text
 * somebody typed, and building SQL by quoting it is how a stewardship note
 * containing an apostrophe becomes a syntax error — or worse, does not.
 */
export function buildStatements(order, rowsByTable, { scrub = false } = {}) {
  const out = [];
  for (const t of [...order].reverse()) out.push({ sql: `DELETE FROM ${t}`, params: [] });

  let rows = 0;
  for (const t of order) {
    const list = rowsByTable[t] || [];
    if (!list.length) continue;
    const cols = Object.keys(list[0]);
    const ph = cols.map(() => "?").join(", ");
    list.forEach((row, i) => {
      const params = cols.map((c) =>
        scrub && (SCRUB[t] || []).includes(c) ? fake(c, i) : row[c] ?? null);
      out.push({ sql: `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${ph})`, params });
      rows += 1;
    });
  }
  return { statements: out, rows };
}

/**
 * One SQL literal.
 *
 * Needed because D1's HTTP API parameterises a SINGLE statement, and sending a
 * few hundred one at a time would spend a few hundred subrequests - a Worker
 * gets fifty on the free plan. So the far side receives one script, and the
 * values are rendered here.
 *
 * Which makes this the one place in the transfer where a stewardship note
 * containing an apostrophe could end a statement early. Quotes are doubled,
 * bytes go as hex, and anything that cannot be represented is refused loudly
 * rather than guessed at.
 */
export function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("cannot render " + v + " as SQL");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const b = new Uint8Array(v instanceof ArrayBuffer ? v : v.buffer);
    return "X'" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("") + "'";
  }
  const str = String(v);
  /* A NUL cannot appear inside a SQLite text literal - it ends the string as
     the parser reads it, so the row would arrive truncated with no error
     raised anywhere. */
  if (str.indexOf(String.fromCharCode(0)) !== -1) {
    throw new Error("value contains a NUL byte");
  }
  return "'" + str.replace(/'/g, "''") + "'";
}

/** The whole transfer as one script, for the side reached over HTTP. */
export function renderSql(statements) {
  return statements.map(({ sql, params }) => {
    let i = 0;
    return sql.replace(/\?/g, () => lit(params[i++])) + ";";
  }).join("\n");
}
