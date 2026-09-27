#!/usr/bin/env node
/**
 * Sharing — everything that goes on other websites
 *   node test/sharing-page.test.mjs
 *
 * Mockup board 9. The four widgets, the sign-up form and the contact form on
 * one page, with one save bar. This runs the real script against the built
 * page and reads what reaches `fetch`: that each change waits for Save, and
 * that Save sends only what changed, each to the endpoint that owns it.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/sharing/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/sharing/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("Sharing — everything that goes on other websites\n");
if (!existsSync(PAGE)) {
  console.log(`  SKIP  ${PAGE} is missing — run the build first.`);
  process.exit(1);
}

const YOU = { email: "chase@thauma.one", name: "Chase", roles: ["admin", "staff"], is_admin: true };
const PARTNER = { id: "p_c", slug: "chase-roush", display_name: "Chase Roush" };
function answers({ admin = true } = {}) {
  return {
    settings: {
      you: { ...YOU, is_admin: admin }, partner: PARTNER,
      embed: { enabled: true, accent: "#1AE4FF", accent2: null, theme: "auto",
               shared: { roadmap: true, goal: false, prayer: false, videos: false } },
      timeline: { start: "2026-01-01", end: "2027-12-31" },
      languages: [{ code: "en", name: "English", is_enabled: true },
                  { code: "hr", name: "Croatian", native_name: "Hrvatski", is_enabled: true }],
    },
    preview: {
      version: 1, partner: { slug: "chase-roush", display_name: "Chase Roush" },
      theme: { accent: "#1AE4FF", mode: "auto" }, languages: [{ code: "en", name: "English" }],
      milestones: [], goals: [], prayer: [], videos: [], shared: ["roadmap"],
    },
    mail: {
      you: YOU, partner: PARTNER, scope: "partner", may_send_as_organisation: true,
      lists: [
        { id: "l1", name: "Newsletter", is_open: 1, form_heading: "Stay in touch", form_blurb: "",
          form_button: "", from_name: "Chase", from_email: "news@x.one", reply_to: "", description: "" },
        { id: "l2", name: "Test", is_open: 0, form_heading: "", form_blurb: "", form_button: "",
          from_name: "Chase", from_email: "news@x.one", reply_to: "", description: "" },
      ],
      senders: [{ address: "noreply@thauma.one" }],
      contact: { deliver_to: "OLD@thauma.one", from_address: "noreply@thauma.one",
                 heading: "Contact", blurb: "", button: "Send", thanks: "", is_open: 1 },
      topics: [{ label: "Prayer request", deliver_to: "" }],
      embed: { accent: "#1AE4FF", theme: "auto", enabled: true, signup_form_open: true },
      /* Each form's own words, per language (0039). */
      form_words: { signup: { en: { heading: "Stay in touch", blurb: "", button: "", thanks: "" } },
                    contact: { en: { heading: "Contact", blurb: "", button: "Send", thanks: "" } } },
    },
  };
}

async function boot({ hash = "", admin = true } = {}) {
  const sent = [];
  const a = answers({ admin });
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/sharing/" + hash,
  });
  const w = dom.window;
  w.fetch = async (url, opts = {}) => {
    url = String(url);
    const method = opts.method || "GET";
    if (method !== "GET") sent.push({ url, method, body: JSON.parse(opts.body) });
    const body = url.includes("staff-settings") ? a.settings
      : url.includes("staff-embed") ? a.preview : a.mail;
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "staff-sharing.js"]) {
    w.eval(readFileSync("src/js/" + f, "utf8"));
  }
  w.StaffToast = () => {};
  w.StaffConfirm = async () => true;
  await settle(150);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const item = (k) => d.querySelector(`#shList [data-item="${k}"]`);
  const pick = async (k) => { click(item(k)); await settle(); };
  const save = async () => { click(d.getElementById("shSave")); await settle(200); };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
  return { w, d, sent, click, item, pick, save, type };
}

await check("the six are listed, each saying whether it is live", async () => {
  const { item } = await boot();
  const state = (k) => item(k).querySelector(".sh-item-state").textContent;
  eq(["roadmap", "goal", "prayer", "videos", "signup", "contact"].map(state),
    ["Live", "Not shared", "Not shared", "Not shared", "Live", "Live"], "statuses");
});

await check("nothing waits on arrival", async () => {
  const { d } = await boot();
  eq(d.getElementById("shBar").hidden, true, "the bar with nothing changed");
});

await check("sharing one widget waits for Save, then sends only what is shared", async () => {
  const { d, sent, pick, click, item, save } = await boot();
  await pick("goal");
  click(d.getElementById("shLive"));
  eq(sent.length, 0, "the switch published at once");
  eq(d.getElementById("shBar").hidden, false, "the bar should be up");
  assert(item("goal").classList.contains("is-dirty"), "the row should be marked");
  await save();
  eq(sent.length, 1, "one request");
  eq(sent[0].method, "PATCH", "to settings");
  eq(sent[0].body.embed.shared, { roadmap: true, goal: true, prayer: false, videos: false }, "shared");
});

await check("picking a color never changes what is shared", async () => {
  const { d, sent, click, type, save } = await boot();
  click(d.getElementById("shColorsToggle"));
  type(d.querySelector('#shMinistryPicker [data-hex="1"]'), "#FF6600");
  await save();
  eq(sent[0].body.embed.accent, "#FF6600", "the color");
  eq(sent[0].body.embed.shared, { roadmap: true, goal: false, prayer: false, videos: false }, "sharing kept");
  eq(sent[0].body.embed.looks, {}, "no embed's own look was touched");
});

await check("the ministry's colors fold to two swatches until opened", async () => {
  const { d, click } = await boot();
  eq(d.getElementById("shMinistryPicker").hidden, true, "open on arrival");
  assert(/#1AE4FF/.test(d.getElementById("shPair").textContent), d.getElementById("shPair").textContent);
  click(d.getElementById("shColorsToggle"));
  eq(d.getElementById("shMinistryPicker").hidden, false, "did not open");
  eq(d.getElementById("shColorsToggle").getAttribute("aria-expanded"), "true", "aria-expanded");
});

await check("hue, saturation and brightness move the first color", async () => {
  const { d, click, type } = await boot();
  click(d.getElementById("shColorsToggle"));
  const box = d.getElementById("shMinistryPicker");
  eq(box.querySelector('[data-num="1v"]').textContent, "100%", "#1AE4FF is at full brightness");
  type(box.querySelector('[data-ch="1v"]'), "50");
  eq(box.querySelector('[data-num="1v"]').textContent, "50%", "brightness shown");
  eq(box.querySelector('[data-hex="1"]').value, "#0D7280", "half as bright, same hue and saturation");
  eq(d.getElementById("shBar").hidden, false, "a change waits for Save");
});

await check("the second color is a number of degrees round, or free", async () => {
  const { d, sent, click, save } = await boot();
  click(d.getElementById("shColorsToggle"));
  const box = d.getElementById("shMinistryPicker");
  const on = () => box.querySelector('[data-turn][aria-checked="true"]').dataset.turn;
  eq(on(), "-33", "a ministry that never chose sits at -33, as before");
  eq([...box.querySelectorAll("[data-turn]")].map((b) => b.textContent), ["\u221233°", "120°", "180°", "Free"], "the choices");
  click(box.querySelector('[data-turn="180"]'));
  eq(box.querySelectorAll('[data-ch^="2"]').length, 0, "a turned second color has no sliders of its own");
  click(box.querySelector('[data-turn="free"]'));
  eq(box.querySelectorAll('[data-ch^="2"]').length, 3, "Free gives the second its own three");
  const second = box.querySelector('[data-hex="2"]').value;
  await save();
  eq([sent[0].body.embed.accent2, sent[0].body.embed.turn], [second, 180],
    "Free keeps the color it was showing, and the turn is kept for later");
});

await check("an embed wears the ministry's colors, or its own", async () => {
  const { d, sent, pick, click, type, save, item } = await boot();
  await pick("goal");
  eq(d.getElementById("shOwnPicker").hidden, true, "its own picker shows before it has its own");
  click(d.querySelector('#shLookSeg [data-look="own"]'));
  eq(d.getElementById("shOwnPicker").hidden, false, "Its own opens the wheel");
  eq(d.querySelector('#shOwnPicker [data-hex="1"]').value, "#1AE4FF", "starts from the ministry's");
  type(d.querySelector('#shOwnPicker [data-hex="1"]'), "#E4572E");
  assert(item("goal").classList.contains("is-dirty"), "the row should be marked");
  await settle(250);
  assert(/"accent":"#E4572E"/.test(d.getElementById("shFrame").getAttribute("srcdoc") || ""),
    "the preview does not wear the embed's own color");
  await save();
  eq(sent[0].body.embed.accent, "#1AE4FF", "the ministry's color moved");
  eq(sent[0].body.embed.looks, { goal: { accent: "#E4572E", accent2: null, turn: null, theme: null } }, "its own");
});

await check("each embed has its own background, and going back to the ministry's clears it", async () => {
  const { w, d, sent, pick, click, save } = await boot();
  await pick("contact");
  const sel = d.getElementById("shTheme");
  eq(sel.value, "auto", "the ministry's background");
  sel.value = "dark";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(d.getElementById("shBar").hidden, false, "a background waits for Save");
  sel.value = "auto";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(d.getElementById("shBar").hidden, true, "back on the ministry's is no change at all");
  sel.value = "dark";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await save();
  eq(sent[0].body.embed.looks, { contact: { accent: null, accent2: null, turn: null, theme: "dark" } }, "its own background");
});

await check("only an administrator switches a widget or its colors", async () => {
  const { d, click, pick } = await boot({ admin: false });
  await pick("prayer");
  eq(d.getElementById("shLive").disabled, true, "the switch should be disabled");
  eq(d.getElementById("shAdminOnly").hidden, false, "and say who changes it");
  click(d.getElementById("shLive"));
  eq(d.getElementById("shBar").hidden, true, "a refused click still made a change");
  click(d.querySelector('#shLookSeg [data-look="own"]'));
  eq(d.getElementById("shBar").hidden, true, "a refused Its own still made a change");
  click(d.getElementById("shColorsToggle"));
  eq(d.querySelector('#shMinistryPicker [data-hex="1"]').disabled, true, "the colors too");
});

await check("the sign-up form: a list saved whole, the form's words saved as the form's", async () => {
  const { d, sent, pick, click, type, save } = await boot();
  await pick("signup");
  click(d.querySelector('#shLists [data-list="l2"]'));
  type(d.querySelector('#shWordFields [data-word="heading"]'), "Hear from us");
  await save();
  const l2 = sent.find((p) => p.body.id === "l2");
  eq([l2 && l2.body.is_open, l2 && l2.body.name], [true, "Test"], "the Test list opened, the rest of it unchanged");
  assert(!sent.some((p) => p.body.id === "l1"), "the untouched list was saved too");
  const w = sent.find((p) => p.body.action === "form-words");
  eq([w.body.form, w.body.words], ["signup", { en: { heading: "Hear from us" } }], "the form's own words");
});

await check("writing Croatian beside English: the English shows above, both are saved", async () => {
  const { w, d, sent, pick, type, save } = await boot();
  await pick("signup");
  const writing = d.getElementById("shWriting");
  assert(/usual words/.test(writing.querySelector('option[value="hr"]').textContent),
    "a language with no words of its own should say it shows the usual ones");
  writing.value = "hr";
  writing.dispatchEvent(new w.Event("change", { bubbles: true }));
  const ref = d.querySelector('#shWordFields .ms-ref');
  eq(ref && ref.textContent, "Stay in touch", "the English heading shown above");
  type(d.querySelector('#shWordFields [data-word="heading"]'), "Javite nam se");
  assert(/data-lang="hr"/.test(d.getElementById("shFrame").srcdoc || "") ||
    await new Promise((r) => setTimeout(() => r(/data-lang="hr"/.test(d.getElementById("shFrame").srcdoc)), 250)),
    "the preview should be in the language being written");
  await save();
  const f = sent.find((p) => p.body.action === "form-words");
  eq(f.body.words, { en: { heading: "Stay in touch" }, hr: { heading: "Javite nam se" } }, "both languages");
});

await check("the sign-up form's Live switch is its own request", async () => {
  const { d, sent, pick, click, save } = await boot();
  await pick("signup");
  click(d.getElementById("shLive"));
  await save();
  eq(sent.map((s) => s.body.action), ["signup-form"], "requests");
  eq(sent[0].body.open, false, "switched off");
});

await check("the contact form: clicking a field does not redraw it, and Save sends what is on screen", async () => {
  /* The bug the Mailing page once had: clicking inside the editor redrew it
     from the saved values, under the caret, and before Save read them. */
  const { w, d, sent, pick, type, save } = await boot();
  await pick("contact");
  const to = d.getElementById("shCtTo");
  type(to, "NEW@thauma.one");
  const reason = d.querySelector("#shTopics .ct-topic-label");
  reason.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await settle();
  eq(d.querySelector("#shTopics .ct-topic-label"), reason, "the field was replaced by a click on itself");
  eq(d.getElementById("shCtTo").value, "NEW@thauma.one", "the edit survived the click");
  type(reason, "Prayer");
  await save();
  const c = sent.find((s) => s.body.action === "contact-form");
  assert(c, "no contact save");
  eq([c.body.deliver_to, c.body.topics], ["NEW@thauma.one", [{ label: "Prayer", deliver_to: "" }]], "sent");
});

await check("Discard puts everything back", async () => {
  const { d, sent, pick, click } = await boot();
  await pick("goal");
  click(d.getElementById("shLive"));
  click(d.getElementById("shDiscard"));
  await settle();
  eq(d.getElementById("shBar").hidden, true, "the bar should be gone");
  eq(d.getElementById("shLive").getAttribute("aria-checked"), "false", "the switch is back off");
  eq(sent.length, 0, "Discard sent something");
});

await check("whose form — Thauma's or the ministry's — is offered only with the forms", async () => {
  const { d, pick } = await boot();
  await pick("roadmap");
  eq(d.getElementById("shScope").hidden, true, "beside a widget");
  await pick("contact");
  eq(d.getElementById("shScope").hidden, false, "beside a form");
});

await check("a reload comes back to the same one", async () => {
  const { item } = await boot({ hash: "#contact" });
  assert(item("contact").classList.contains("is-on"), "opened on something else");
});

/* ---- the preview fits ---- */

function report(w, d, h) {
  const frame = d.getElementById("shFrame");
  const fake = {};
  Object.defineProperty(frame, "contentWindow", { value: fake, configurable: true });
  w.dispatchEvent(new w.MessageEvent("message", { data: { __thaumaHeight: h }, source: fake }));
  return { frame, wrap: d.getElementById("shScale"), stage: d.getElementById("shStage"),
           note: d.getElementById("shScaleNote") };
}

await check("a tall form is scaled down to fit, full-size inside, and says so", async () => {
  const { w, d, pick } = await boot();
  await pick("contact");
  const { frame, wrap, stage, note } = report(w, d, 760);
  eq(stage.style.blockSize, "480px", "the box");
  eq(frame.style.blockSize, "760px", "the frame stays full size — only the wrapper scales");
  assert(/scale\(0\.63/.test(wrap.style.transform), wrap.style.transform);
  const width = parseFloat(wrap.style.inlineSize);
  assert(Math.abs(width * 0.6316 - 100) < 0.5, `the wrapper is widened by what the scale takes back: ${width}%`);
  assert(/63%/.test(note.textContent), `the scale must be stated: ${note.textContent}`);
  report(w, d, 400);
  eq([stage.style.blockSize, wrap.style.transform, note.textContent], ["400px", "", ""], "a short form at 1:1");
  report(w, d, 99999);
  assert(parseInt(stage.style.blockSize, 10) <= 480, `a nonsense height opened the box: ${stage.style.blockSize}`);
});

await check("a widget on Desktop is drawn at a desktop page's width", async () => {
  /* The widget picks its layout from its width; at the middle column's own
     width the roadmap would draw as a phone's column. */
  const { w, d, pick } = await boot();
  await pick("roadmap");
  d.getElementById("shStage").getBoundingClientRect = () => ({ width: 620, height: 0, top: 0, left: 0 });
  const { wrap } = report(w, d, 300);
  eq(wrap.style.inlineSize, "1000px", "drawn at desktop width");
  assert(/scale\(0\.62\)/.test(wrap.style.transform), wrap.style.transform);
});

await check("the stage clips what the scaled frame overhangs", async () => {
  const css = readFileSync("src/css/staff.css", "utf8");
  assert(/#shStage\{overflow:hidden\}/.test(css), "the stage does not clip");
  assert(/\.emb-scale\{transform-origin:top left/.test(css), "the scale must start top left");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
