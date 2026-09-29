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
  /* The most sensitive column in the database — a bereavement, an illness —
     and it arrived in 0034 AFTER this list was written. A list of what to
     scrub only covers what somebody remembered to put on it, which is why
     test/dbsync.test.mjs now asks the schema for every note/notes column
     rather than trusting this one to be complete. */
  life_events: ["note"],
  /* A note asking the owner to edit their site (0044) — free text. */
  partner_site_requests: ["note"],
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
    /* Not "interaction note": since 0034 the same column name is a life
       event's too, and the placeholder should not claim to be the wrong one. */
    case "note": return "[scrubbed] note";
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

/* ===========================================================================
 * CARRYING DEV'S DATA FORWARD — Preview and Publish (Chase, 2026-09-29)
 * ===========================================================================
 * "The dev site doesn't populate data correctly to the Preview and live sites.
 * When I push, the data should populate to those as well. And if account data
 * isn't synced, then that is still a problem."
 *
 * Dev is where the ministry's content is made, so Preview and Publish carry it:
 *   Preview   staging becomes dev's copy (replace, personal columns scrubbed)
 *   Publish   dev's rows are ADDED AND UPDATED on live — never deleted there
 * Chosen by Chase over "replace live" (which would erase what only live has)
 * and over "live is the source" (which would move content-making off dev).
 * When real people start using the live console, that choice flips.
 */

/** Tables whose rows are born on the live site and never written there from
    dev: people who signed up, who a mailing reached, and credentials — an API
    key made on dev is a test key, and must not start working on live. */
export const LIVE_KEEPS = new Set([
  "subscribers", "subscriber_tags", "signup_attempts", "mailing_recipients", "api_keys",
]);

/* D1 refuses a statement longer than 100,000 bytes. A website draft can be
   several times that, so a long value is sent in pieces: the row with the
   value empty, then appended to. Characters, not bytes: 20,000 characters is
   at most 80,000 bytes of UTF-8. */
const PIECE = 20000;

function withPieces(t, pk, row, cols) {
  const long = cols.filter((c) => typeof row[c] === "string" && row[c].length > PIECE);
  if (!long.length || !pk || !pk.length) return { row, tail: [] };
  const first = { ...row };
  const tail = [];
  for (const c of long) {
    first[c] = "";
    for (let i = 0; i < row[c].length; i += PIECE) {
      tail.push({
        sql: `UPDATE ${t} SET ${c} = ${c} || ? WHERE ${pk.map((k) => `${k} IS ?`).join(" AND ")}`,
        params: [row[c].slice(i, i + PIECE), ...pk.map((k) => row[k])],
      });
    }
  }
  return { row: first, tail };
}

/**
 * Staging's copy: everything replaced — except the one thing that cannot be.
 *
 * The master account (0026) refuses to be deleted or to lose a role, by
 * trigger, so a plain DELETE-everything aborts on its first row; the old Push
 * to staging button failed exactly there. So what CAN be deleted is, and then
 * dev's rows are written the merge's way (below): the master account is
 * updated in place, everything else arrives fresh. Personal columns are
 * scrubbed — staging is on the internet and is a rehearsal, not a record.
 *
 *   meta[t] = { cols, pk, uniques, fks }   far = the rows that survive
 */
export function planReplace(order, rowsByTable, meta, far = {}) {
  const tables = order.filter((t) => meta[t] && !SKIP_TABLES.has(t));
  const hasProtected = meta.users && meta.users.cols.includes("protected");
  const deletes = [...tables].reverse().map((t) => {
    if (hasProtected && t === "users") return { sql: "DELETE FROM users WHERE protected = 0", params: [] };
    if (hasProtected && t === "user_roles") {
      return { sql: "DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users WHERE protected = 1)", params: [] };
    }
    return { sql: `DELETE FROM ${t}`, params: [] };
  });
  const scrubbed = {};
  for (const t of tables) {
    scrubbed[t] = (rowsByTable[t] || []).map((r, i) => {
      const x = { ...r };
      for (const c of SCRUB[t] || []) if (c in x) x[c] = fake(c, i);
      return x;
    });
  }
  const merged = planMerge(order, scrubbed, meta, far, { keepLive: false });
  return { statements: [...deletes, ...merged.statements], rows: merged.rows, matched: merged.matched };
}

const keyOf = (row, cols) => JSON.stringify(cols.map((c) =>
  typeof row[c] === "string" ? row[c].toLowerCase() : row[c]));

/**
 * Live's merge: dev's rows added, or updated where live has the same row.
 * Nothing is deleted, and LIVE_KEEPS are not touched at all.
 *
 * THE SAME THING UNDER TWO NAMES. Live was seeded on its own, so its ministry
 * is `p_chase` while dev's is `p_chase_roush` — one ministry, one slug, two
 * ids. Inserting dev's would break the slug's UNIQUE and stop the whole
 * publish. So a dev row that matches a live row on a UNIQUE column (a slug,
 * an email) IS that row: it takes live's id, and every dev row pointing at it
 * is pointed at live's id instead. Worked out table by table in load order, so
 * a parent's new id is known before its children are written.
 *
 *   meta[t] = { cols, pk, uniques: [[col, …], …], fks: [{ from, table, to }] }
 *   far[t]  = live's rows (primary key and unique columns) for tables that
 *             have a single-column primary key and a UNIQUE constraint
 *
 * Where both sides changed the same row, dev's version wins (Chase's choice).
 */
export function planMerge(order, rowsByTable, meta, far = {}, { keepLive = true } = {}) {
  const tables = order.filter((t) => meta[t] && !SKIP_TABLES.has(t) && !(keepLive && LIVE_KEEPS.has(t)));
  const remap = {};
  const matched = [];
  const out = [];
  let rows = 0;

  for (const t of tables) {
    const { cols, pk, uniques = [], fks = [] } = meta[t];
    let list = (rowsByTable[t] || []).map((r) => {
      const x = { ...r };
      for (const fk of fks) {
        const m = remap[fk.table];
        if (m && x[fk.from] != null && m.has(x[fk.from])) x[fk.from] = m.get(x[fk.from]);
      }
      return x;
    });

    if (pk.length === 1 && uniques.length && far[t]) {
      const id = pk[0];
      const usable = uniques.filter((u) => u.every((c) => cols.includes(c)));
      const index = usable.map((u) => new Map(far[t].map((r) => [keyOf(r, u), r[id]])));
      list = list.map((r) => {
        for (let k = 0; k < usable.length; k++) {
          if (usable[k].some((c) => r[c] == null)) continue;
          const theirs = index[k].get(keyOf(r, usable[k]));
          if (theirs != null && theirs !== r[id]) {
            (remap[t] = remap[t] || new Map()).set(r[id], theirs);
            matched.push({ table: t, dev: r[id], live: theirs });
            return { ...r, [id]: theirs };
          }
        }
        return r;
      });
    }

    const rest = cols.filter((c) => !pk.includes(c));
    const onConflict = !pk.length ? null
      : rest.length ? `ON CONFLICT (${pk.join(", ")}) DO UPDATE SET ${rest.map((c) => `${c} = excluded.${c}`).join(", ")}`
      : `ON CONFLICT (${pk.join(", ")}) DO NOTHING`;
    for (const raw of list) {
      const full = {};
      for (const c of cols) full[c] = raw[c] ?? null;
      const { row, tail } = withPieces(t, pk, full, cols);
      /* A NULL in the key — the organization's own contact form is the row
         with no partner. ON CONFLICT never matches a NULL (two NULLs are not
         equal), so the second publish would add it again; it is updated
         where it is, and added only when absent. */
      if (pk.length && pk.some((k) => row[k] == null)) {
        const where = pk.map((k) => `${k} IS ?`).join(" AND ");
        const keys = pk.map((k) => row[k]);
        if (rest.length) {
          out.push({ sql: `UPDATE ${t} SET ${rest.map((c) => `${c} = ?`).join(", ")} WHERE ${where}`,
                     params: [...rest.map((c) => row[c]), ...keys] });
        }
        out.push({ sql: `INSERT INTO ${t} (${cols.join(", ")}) SELECT ${cols.map(() => "?").join(", ")} ` +
                        `WHERE NOT EXISTS (SELECT 1 FROM ${t} WHERE ${where})`,
                   params: [...cols.map((c) => row[c]), ...keys] }, ...tail);
        rows += 1;
        continue;
      }
      out.push({
        sql: `INSERT ${onConflict ? "" : "OR IGNORE "}INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})` +
             (onConflict ? " " + onConflict : ""),
        params: cols.map((c) => row[c]),
      }, ...tail);
      rows += 1;
    }
  }
  return { statements: out, rows, matched };
}

/**
 * Rendered scripts no larger than `max` bytes each, so no single request to
 * D1's HTTP API carries the whole database. Statements are never split.
 */
export function scripts(statements, max = 400000) {
  const enc = new TextEncoder();
  const out = [];
  let cur = [], size = 0;
  for (const s of statements) {
    const line = renderSql([s]);
    const n = enc.encode(line).length + 1;
    if (cur.length && size + n > max) { out.push(cur.join("\n")); cur = []; size = 0; }
    cur.push(line); size += n;
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}
