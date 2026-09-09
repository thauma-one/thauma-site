#!/usr/bin/env node
/**
 * American spelling, because Thauma is a US organization
 *   node test/us-english.test.mjs
 *
 * This was written in British English throughout — colour, organisation,
 * behaviour, centre, grey, catalogue — across the console, the public pages,
 * the emails and the comments. A US ministry's staff reading "colour" on their
 * own admin screen is a small thing that reads as somebody else's site.
 *
 * WHAT THIS DOES NOT TOUCH, and must not. Some of these words are code:
 *
 *   '~organisation'   a sentinel inside five UNIQUE indexes. Changing it needs
 *                     a migration that rebuilds them, for no reader's benefit.
 *   catalogue_order   a SQL alias the console reads by name.
 *   .emb-colour       CSS classes matched from JavaScript.
 *   emb.colours       an i18n KEY; its VALUE is "Colors" and that is the part
 *                     anybody sees.
 *   COLOUR_JS         module constants; embed-colour.js, a filename.
 *
 * The rule is: what a person reads is American; what a machine matches is left
 * exactly as it is. So this checks the readable surfaces and skips the rest.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("American spelling\n");

/* The British form, and what it should be. Word-boundaried, case-insensitive. */
const BRITISH = [
  ["colour", "color"], ["colours", "colors"], ["coloured", "colored"],
  ["organisation", "organization"], ["organisations", "organizations"],
  ["organise", "organize"], ["organised", "organized"],
  ["behaviour", "behavior"], ["behaviours", "behaviors"],
  ["grey", "gray"], ["greyscale", "grayscale"],
  ["catalogue", "catalog"], ["centre", "center"], ["centred", "centered"],
  ["honour", "honor"], ["labelled", "labeled"], ["labelling", "labeling"],
  ["cancelled", "canceled"], ["cancelling", "canceling"],
  ["authorise", "authorize"], ["authorised", "authorized"],
  ["recognise", "recognize"], ["recognised", "recognized"],
  ["normalise", "normalize"], ["enquiry", "inquiry"], ["enquiries", "inquiries"],
  ["programme", "program"], ["theatre", "theater"], ["defence", "defense"],
  ["judgement", "judgment"], ["cheque", "check"], ["licence", "license"],
  ["neighbour", "neighbor"], ["apologise", "apologize"], ["whilst", "while"],
  ["amongst", "among"], ["learnt", "learned"], ["fulfil", "fulfill"],
  ["modelled", "modeled"], ["travelled", "traveled"], ["practise", "practice"],
];

/* Left alone on purpose — see the note at the top. A match that sits inside
   one of these is a machine's word, not a reader's. */
const PROTECTED = [
  "~organisation", "may_send_as_organisation", "may_use_organisation",
  "catalogue_order", "0013_language_catalogue_backfill",
  "t_staff_may_not_edit_the_organisations_resources",
  "t_the_organisation_list_belongs_to_no_partner",
  "t_two_organisation_lists_cannot_share_a_slug", "t_language_catalogue_is_open",
  "saveColours", "colourInput", "ctColours", "secondColour", "catalogueError",
  "data-save-colours", "emb-colour", "ml-colours", "ct-colours", "colour-1",
  "embed-colour", "COLOUR_JS", "BEHAVIOUR_JS", "cropCancelled", "emb.colours",
  "codeFence",
];

const SKIP_DIRS = new Set([
  ".git", "node_modules", "_site", "_site_next", "_site_prod", ".wrangler", "coverage",
  /* Build output. Scanning it reports every finding twice — once in the source
     that can be fixed and once in the artifact that cannot — and a generated
     file is never the thing to edit. */
  "dist",
]);
const EXTS = new Set([".js", ".mjs", ".njk", ".css", ".md", ".json", ".sql", ".py",
                      ".html", ".yml", ".yaml", ".toml", ".sh"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

/* Skips this file, which necessarily contains every British spelling there is. */
const FILES = walk(".").filter((p) => !p.endsWith("us-english.test.mjs"));

function findings() {
  const out = [];
  for (const p of FILES) {
    let text;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      /* Where a protected identifier sits on this line, so a hit inside one
         can be ignored without ignoring the whole line. */
      const spans = [];
      for (const tok of PROTECTED) {
        let at = 0;
        while ((at = line.indexOf(tok, at)) !== -1) { spans.push([at, at + tok.length]); at++; }
      }
      for (const [bad, good] of BRITISH) {
        const re = new RegExp(`\\b${bad}\\b`, "gi");
        let m;
        while ((m = re.exec(line)) !== null) {
          const inside = spans.some(([s, e]) => s <= m.index && m.index + m[0].length <= e);
          if (!inside) out.push({ p, line: i + 1, bad: m[0], good, text: line.trim().slice(0, 90) });
        }
      }
    });
  }
  return out;
}

const found = findings();

await check("nothing readable is written in British English", async () => {
  const shown = found.slice(0, 12)
    .map((f) => `${f.p}:${f.line}  "${f.bad}" -> "${f.good}"\n              ${f.text}`)
    .join("\n            ");
  assert(found.length === 0,
    `${found.length} British spelling(s):\n            ${shown}` +
    (found.length > 12 ? `\n            …and ${found.length - 12} more` : ""));
});

await check("the identifiers that must not change are still there", async () => {
  /* The other half. A sweep that "fixed" '~organisation' would pass the check
     above and break five UNIQUE indexes, so the protection is asserted too. */
  const all = FILES.map((p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } }).join("\n");
  for (const tok of ["catalogue_order", "COLOUR_JS", "emb-colour", "colourInput",
                     "may_send_as_organisation"]) {
    assert(all.includes(tok),
      `${tok} has been renamed — it is a machine's word, not a reader's, and ` +
      `something that matches it by name will now silently miss`);
  }

  /* THE SENTINEL, CHECKED PROPERLY. "Does '~organisation' appear somewhere" is
     satisfied by any one of the five UNIQUE indexes still having it, so a
     sweep that renamed four would pass. What matters is that they AGREE: two
     indexes with different sentinels do not collide where they must, and the
     uniqueness they exist to enforce quietly stops being enforced.

     Read from the migrations rather than restated here, so adding a sixth
     index joins this check by existing. */
  const migs = FILES.filter((p) => p.includes("db/migrations") && p.endsWith(".sql"));
  /* A LIST, not a map keyed by filename — 0015_mailing.sql declares two of
     these, and keying by file collapsed them to one and made the count wrong. */
  const sentinels = [];
  for (const p of migs) {
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/COALESCE\(\s*partner_id\s*,\s*'([^']+)'/g)) {
      sentinels.push({ file: p, value: m[1] });
    }
  }
  const distinct = new Set(sentinels.map((x) => x.value));
  assert(sentinels.length >= 5,
    `only ${sentinels.length} partner_id sentinels found; expected at least the five UNIQUE indexes`);
  assert(distinct.size === 1,
    `the partner_id sentinel differs between migrations, so their UNIQUE ` +
    `indexes no longer agree: ` +
    sentinels.map((x) => `${x.file}='${x.value}'`).join(", "));
});

await check("the user-facing English strings are American", async () => {
  /* The part that actually shows on screen, checked directly rather than
     inferred from the sweep above. */
  const i18n = readFileSync("src/js/staff-i18n.js", "utf8");
  const en = i18n.slice(i18n.indexOf("en:"), i18n.indexOf("hr:"));
  for (const [bad] of BRITISH) {
    const re = new RegExp(`['"\`][^'"\`]*\\b${bad}\\b[^'"\`]*['"\`]`, "i");
    const m = en.match(re);
    /* Keys are quoted too, so a hit is only a problem when it is not a key. */
    if (m && !/^['"`](adm|ms|res|emb|ml|pc|err|common|act|toast)\./.test(m[0])) {
      assert(false, `an English console string still says "${bad}": ${m[0].slice(0, 70)}`);
    }
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
