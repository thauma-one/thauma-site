/**
 * translate.js — /api/translate, a machine's first draft of a translation
 *
 *   GET                                   { available, model }
 *   POST { from, to, items: [{ id, text }] }
 *                                         { items: [{ id, text, check? }] }
 *
 * Chase, 2026-09-28: "build in the Cloudflare AI even if it isn't accurate or
 * reliable for now. That way we can test all the translation functions and
 * make sure that each individual field can be translated properly."
 *
 * A DRAFT, NEVER A SAVE. This only returns words. Every editor puts them in
 * its field as if somebody had typed them, where they wait for Save or
 * Publish like anything else — so nothing a machine wrote reaches the public
 * without a person having had it on screen.
 *
 * THE RULES IT IS GIVEN are the ones a translator gets (Website › Pages ›
 * Languages): words that are never translated, fixed phrases per language,
 * and each language's own guide. Plus what the machinery needs kept whole:
 * <b>…</b> marks and {placeholders}. An answer that lost either comes back
 * flagged `check`, and the page says so.
 *
 * WHERE IT RUNS: wherever the Worker has an AI binding (wrangler.toml —
 * staging, live and the Pi — see the note there about the Pi's token).
 * Without one, GET answers available: false and the Translate buttons stay
 * hidden.
 *
 * Any signed-in console account may ask: the words it translates are ones
 * that person is already editing. Bounded per request so a mistake cannot
 * run up a bill: at most 40 fields, 2,000 characters each, 12,000 in all.
 *
 * AND BOUNDED PER DAY, so it never costs anything (Chase, 2026-09-29: "I
 * want to make sure I don't exceed the credit usage … You can make sure of
 * that"). Cloudflare gives the ACCOUNT 10,000 Neurons a day free, and dev,
 * staging and live share that account — so each has a fixed share,
 * AI_DAILY_NEURONS in wrangler.toml (live 6,000, staging 1,500, dev 1,500:
 * 9,000, leaving a margin; a test holds the sum there). Every call's worst
 * case is reserved in the ai_usage table before it is made, in a statement
 * that refuses to pass the share (0046), and replaced afterwards by what
 * Cloudflare reports it used. The answer cannot be longer than its
 * max_tokens, so the worst case is a real ceiling, not a guess.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";

/* One place to change it. A general instruction model rather than a
   translation-only one (m2m100): the rules below — keep the bold marks and
   placeholders, never translate these names, write Serbian in Cyrillic —
   are instructions, and only an instruction model follows them. */
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MAX_ITEMS = 40, MAX_TEXT = 2000, MAX_TOTAL = 12000;

/* Cloudflare's published price for MODEL, in Neurons per token. */
const NEURONS_IN = 26668 / 1e6, NEURONS_OUT = 204805 / 1e6;
/* A deployment that names no share gets 3,000: three of them still fit. */
const DEFAULT_SHARE = 3000;

export function dailyShare(env) {
  const n = Number(env && env.AI_DAILY_NEURONS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SHARE;
}

/** The longest answer a request may produce: the translation of every piece
    (a character is at least half a token of it, in any script), plus the
    JSON around each, plus a little. max_tokens, and so a hard ceiling. */
export function answerCeiling(items) {
  const chars = items.reduce((n, it) => n + it.text.length, 0);
  return Math.min(4096, Math.ceil(chars / 1.5) + 24 * items.length + 64);
}

/** The most a call can cost: every BYTE of the question a token (a token is
    never less than a byte — a Cyrillic letter is two), the chat template's
    own few, and the whole ceiling of the answer. */
export function worstCase(systemPrompt, userPrompt, maxTokens) {
  const bytes = new TextEncoder().encode(systemPrompt + userPrompt).length;
  return (bytes + 64) * NEURONS_IN + maxTokens * NEURONS_OUT;
}

const today = () => new Date().toISOString().slice(0, 10);
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/* What a language needs said that its name does not say. The language's own
   guide, written on Website › Pages › Languages, comes after this and wins. */
const HOUSE = {
  sr: "Write Serbian in Cyrillic script, in the ekavian dialect.",
};

function langName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code; }
  catch { return code; }
}

/** The instruction, from the organization's own translation notes. */
export function instruction(from, to, notes) {
  const lines = [
    `You translate short pieces of a Christian ministry's website and staff console from ${langName(from)} to ${langName(to)}.`,
    "Keep the meaning, tone and length close to the original. Do not add or explain anything.",
    "Keep every <b> and </b> exactly where the matching words are, and keep every {placeholder} in curly braces exactly as written.",
    "Never translate the name Thauma; keep it in Latin letters.",
  ];
  if (HOUSE[to]) lines.push(HOUSE[to]);
  if (notes.keep.length) lines.push("Never translate these; write them exactly as given: " + notes.keep.join(", ") + ".");
  if (notes.glossary.length) {
    lines.push("Always use these renderings:");
    notes.glossary.forEach((g) => lines.push(`- "${g.source}" → "${g.target}"`));
  }
  if (notes.guide) lines.push("The language's own guide (follow it over anything above):", notes.guide);
  lines.push('Answer with JSON only: {"items":[{"id":"…","text":"…"}]}, one item for each item given, same ids.');
  return lines.join("\n");
}

/** The same {placeholders} and the same number of bold marks? */
export function looksWhole(src, out) {
  const ph = (s) => (String(s).match(/\{[a-zA-Z_]+\}/g) || []).sort().join(",");
  const bold = (s) => (String(s).match(/<\/?b>/g) || []).length;
  return ph(src) === ph(out) && bold(src) === bold(out);
}

/** Nothing but text and <b>: the answer is put into a page. */
export function clean(s) {
  return String(s || "").replace(/<(?!\/?b>)[^>]*>/g, "").trim();
}

/** The model's answer, read leniently: the first {...} that parses. */
export function parseAnswer(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function notesFor(db, to) {
  const [keep, glossary, guides] = await Promise.all([
    db.query("translation_keep_all", {}),
    db.query("translation_glossary_all", {}),
    db.query("translation_guides_all", {}),
  ]);
  const guide = guides.find((g) => g.lang === to);
  return {
    keep: keep.map((k) => k.term),
    glossary: glossary.filter((g) => g.lang === to).map((g) => ({ source: g.source, target: g.target })),
    guide: guide ? guide.guidance : "",
  };
}

export default {
  async fetch(request, env) {
    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);
    const db = createDb(env.DB);
    const actor = await resolveActor(request, env, db, user);
    if (!actor.me) return json({ error: "This address is not an active account." }, 403);

    if (request.method === "GET") {
      const row = await db.queryOne("ai_usage_today", { day: today() }).catch(() => null);
      return json({ available: !!env.AI, model: MODEL,
        share: dailyShare(env), used: Math.round((row && row.neurons) || 0) });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
    if (!env.AI) {
      return json({ error: "Machine translation is not switched on for this copy of the site." }, 503);
    }

    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const from = String(body.from || ""), to = String(body.to || "");
    if (!LANG_RE.test(from) || !LANG_RE.test(to) || from === to) {
      return json({ error: "Two different languages are needed." }, 400);
    }
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json({ items: [] });
    if (items.length > MAX_ITEMS) return json({ error: `At most ${MAX_ITEMS} at a time.` }, 400);
    let total = 0;
    for (const it of items) {
      if (typeof it.text !== "string" || !it.text.trim()) return json({ error: "Every item needs its text." }, 400);
      if (it.text.length > MAX_TEXT) return json({ error: `One piece is longer than ${MAX_TEXT} characters.` }, 400);
      total += it.text.length;
    }
    if (total > MAX_TOTAL) return json({ error: "Too much at once; translate fewer fields." }, 400);

    const notes = await notesFor(db, to);
    const ask = items.map((it, i) => ({ id: String(it.id ?? i), text: it.text }));
    const system = instruction(from, to, notes), question = JSON.stringify({ items: ask });
    const maxTokens = answerCeiling(ask);

    /* THE DAY'S SHARE, reserved before anything is spent. Refused here means
       nothing was asked of Cloudflare, so nothing can be charged. */
    const day = today(), est = worstCase(system, question, maxTokens), cap = dailyShare(env);
    const held = await db.query("ai_usage_reserve", { day, est, cap });
    if (!held.length) {
      return json({ error: "Today's free translation allowance is used up. It comes back at midnight UTC.",
        code: "ai_resting" }, 429);
    }

    let answer, used = est;
    try {
      const res = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: system }, { role: "user", content: question }],
        max_tokens: maxTokens,
        temperature: 0.2,
      });
      answer = parseAnswer(res && res.response);
      /* What it really used, as Cloudflare counts it; from the tokens if it
         does not say; and if it says neither, the reservation stands. */
      const u = res && res.usage;
      if (u && Number.isFinite(u.neurons)) used = u.neurons;
      else if (u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens)) {
        used = u.prompt_tokens * NEURONS_IN + u.completion_tokens * NEURONS_OUT;
      }
    } catch (err) {
      /* A failed call may still have been counted by Cloudflare: keep the
         reservation rather than guess it was free. */
      /* 500, not 502: Cloudflare swaps a 502 for its own HTML page. */
      return json({ error: "The translator did not answer: " + err.message }, 500);
    }
    /* The true figure, even in the unexpected case it is over the estimate:
       the count must be honest, and the margin under 10,000 absorbs it. */
    await db.query("ai_usage_settle", { day, est, actual: used }).catch(() => {});
    const got = new Map(((answer && answer.items) || []).map((x) => [String(x.id), x.text]));
    const out = ask.map((it) => {
      const text = clean(got.get(it.id));
      if (!text) return { id: it.id, text: "", check: true };
      return looksWhole(it.text, text) ? { id: it.id, text } : { id: it.id, text, check: true };
    });
    return json({ items: out, model: MODEL });
  },
};
