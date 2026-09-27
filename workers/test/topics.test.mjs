#!/usr/bin/env node
/**
 * A contact form's reasons, in every language (0041)
 *   node workers/test/topics.test.mjs
 *
 * One reading of `label` + `labels` for the console, thauma.one's own form
 * and the contact widget, and the endpoints that serve them.
 */
import { topicLabels, topicLabel, cleanLabels } from "../src/lib/topics.js";
import { contactScript } from "../src/contact.js";
import contactForm from "../src/contact-form.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("contact reasons, in every language\n");

const ROW = { id: "t1", label: "General", labels: JSON.stringify({ hr: "Općenito" }) };

await check("a reason reads in the language asked for, else as first written", () => {
  eq(topicLabel(ROW, "hr"), "Općenito", "Croatian");
  eq(topicLabel(ROW, "sr"), "General", "Serbian, not written yet");
  eq(topicLabel(ROW, ""), "General", "no language");
  eq(topicLabel({ label: "General", labels: null }), "General", "every row before 0041");
  eq(topicLabels({ labels: "{broken" }), {}, "unreadable JSON is no translations, not an error");
});

await check("what the console sends is made safe before it is stored", () => {
  eq(cleanLabels({ hr: "  Općenito ", sr: "", "<script>": "x", en: "General" }),
     JSON.stringify({ hr: "Općenito", en: "General" }), "codes only, trimmed, empties dropped");
  eq(cleanLabels({}), null, "nothing left is NULL, like every row before");
  eq(cleanLabels("hr"), null, "not an object");
  eq(JSON.parse(cleanLabels({ hr: "x".repeat(200) })).hr.length, 80, "capped");
});

await check("thauma.one's contact page gets each reason in its own language", async () => {
  const rows = { form: { deliver_to: "a@b.invalid" }, topics: [ROW] };
  const env = { DB: { prepare(sql) {
    const run = async () => ({ results: /FROM contact_forms/.test(sql) ? [rows.form] : rows.topics });
    return { bind() { return { all: run, run }; }, all: run, run };
  } } };
  const ask = async (q) => (await (await contactForm.fetch(
    new Request("https://thauma.one/api/contact" + q, { headers: { Accept: "application/json" } }), env)).json()).topics;
  eq((await ask("?lang=hr")).map((t) => t.label), ["Općenito"], "Croatian page");
  eq((await ask("?lang=en")).map((t) => t.label), ["General"], "English page");
  eq((await ask("")).map((t) => t.label), ["General"], "a page that did not say");
});

await check("the contact widget carries every language and picks the visitor's", () => {
  const js = contactScript({ deliver_to: "a@b.invalid" }, "chase-roush", "https://thauma.one", null, [ROW]);
  new Function(js); // still a valid script
  assert(js.includes('var TOPICS = {"t1":{"hr":"Općenito"}};'), "the widget does not carry the translations");
  assert(/TOPICS\[o\.value\]/.test(js) && /t\[lang\]/.test(js), "the widget does not choose by language");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
