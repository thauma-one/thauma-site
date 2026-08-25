#!/usr/bin/env node
/**
 * The Videos tab, driven for real
 *   node test/videos-console.test.mjs
 *
 * A DOM HARNESS, NOT A SOURCE SCAN. Several tests in this repository have
 * passed while testing nothing — a widget asserted as a string that never
 * parsed, an editor asserted against a command jsdom does not implement. So
 * this loads the BUILT page, evaluates the real script against it, clicks the
 * real buttons, and reads what actually reaches `fetch`.
 *
 * WHAT IT IS LOOKING FOR. The two things this screen can get wrong in a way
 * nobody notices: saying "Saved" over a sync that failed, and rendering a
 * video title as markup. Both are quiet, both are on somebody's public site.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

/* CI builds to _site_next or _site_prod, never _site. Looking only in _site is
   how a test file skips itself in the one place it matters. */
const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/ministry/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/ministry/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b,
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
/* Strict equality is right for the scalar assertions above and useless for
   the rail, which is an array. Kept separate so nobody loosens `eq`. */
const deq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("the Videos tab, driven for real\n");

if (!existsSync(PAGE)) {
  console.log(`  SKIP  ${PAGE} is missing — run the build first.`);
  process.exit(1);            // NOT 0: a skip here is a gap, not a pass.
}

const CHANNEL = "UCnp-pBzHdpTwMonf7xuN1Ug";

function payload(over = {}) {
  return {
    scope: "partner", may_use_organisation: true,
    partner: { id: "p_c", display_name: "Chase Roush" },
    channel: {
      channel_id: CHANNEL, channel_title: "Thauma", is_public: true,
      max_items: 3, synced_at: "2026-08-25T09:00:00Z", sync_error: null,
      channel_url: `https://www.youtube.com/channel/${CHANNEL}`,
    },
    videos: [{
      id: "dQw4w9WgXcQ",
      /* Chosen on purpose: a real channel could have this title, and it is
         exactly what an unescaped render would turn into markup. */
      title: 'Faith & <img src=x onerror="alert(1)"> Works',
      published_at: "2026-08-01T10:00:00+00:00",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }],
    links: [],
    ...over,
  };
}

async function boot(reply = payload()) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only",
    url: "https://next.thauma.one/staff/ministry/",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const sent = [];
  const toasts = [];

  w.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), method: opts.method || "GET",
                body: opts.body ? JSON.parse(opts.body) : null });
    const r = typeof reply === "function" ? reply(sent.length) : reply;
    return { ok: !r.error, status: r.error ? 400 : 200, json: async () => r };
  };
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};

  for (const f of ["staff-i18n.js", "staff.js", "staff-rowpanel.js",
                   "staff-milestones.js", "staff-goals.js", "staff-prayer.js",
                   "staff-videos.js"]) {
    w.eval(readFileSync("src/js/" + f, "utf8"));
  }

  /* AFTER the scripts, not before. staff.js assigns window.StaffToast itself,
     so a spy installed first is silently replaced by the real one and every
     assertion about what the screen SAID passes vacuously against an empty
     array. That is the shape of test this file exists to avoid, and it caught
     itself doing it. */
  w.StaffToast = (msg, kind) => toasts.push({ msg, kind });

  await new Promise((r) => setTimeout(r, 120));
  return { w, sent, toasts };
}

const press = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const openTab = async (w) => {
  press(w, w.document.querySelector('.tab[data-tab="videos"]'));
  await new Promise((r) => setTimeout(r, 120));
};

/* ------------------------------------------------------------------ */

await check("the tab exists and fetches nothing until it is opened", async () => {
  const { w, sent } = await boot();
  assert(w.document.querySelector('.tab[data-tab="videos"]'), "no Videos tab");
  assert(w.document.getElementById("vidForm"), "no form on the page");
  eq(sent.filter((s) => s.url.includes("staff-videos")).length, 0,
     "a tab nobody opened should not cost a request");
});

await check("opening it loads the channel into the form", async () => {
  const { w, sent } = await boot();
  await openTab(w);
  eq(sent.filter((s) => s.url.includes("staff-videos")).length, 1, "one GET");
  eq(w.document.getElementById("vidChannel").value, CHANNEL, "channel field");
  eq(w.document.getElementById("vidCount").value, "3", "count field");
  eq(w.document.getElementById("vidPublic").getAttribute("aria-checked"), "true",
     "the published switch");
  assert(/Thauma/.test(w.document.getElementById("vidFound").innerHTML),
         "the channel's own name should confirm what was found");
});

await check("A VIDEO TITLE IS TEXT, NEVER MARKUP", async () => {
  /* The titles come from YouTube. Nobody at Thauma types them and nobody
     reviews them, so the only thing standing between a channel title and
     script execution in the console is the escaping in renderList(). */
  const { w } = await boot();
  await openTab(w);
  const card = w.document.querySelector(".vid-card");
  assert(card, "no video rendered");
  eq(w.document.querySelectorAll(".vid-list img[onerror]").length, 0,
     "the title was rendered as HTML");
  eq(card.querySelector(".vid-title").textContent,
     'Faith & <img src=x onerror="alert(1)"> Works', "the real title, as text");
});

await check("a failed sync does NOT report success", async () => {
  /* The bug this exists to stop: the request succeeds, the channel is stored,
     the feed could not be read — and a green "Saved" sends somebody away from
     a channel that will never update. */
  const { w, toasts } = await boot(payload({
    checked: { ok: false, error: "YouTube has no channel with that id.", count: 0 },
    channel: { ...payload().channel, sync_error: "YouTube has no channel with that id." },
  }));
  await openTab(w);
  w.document.getElementById("vidChannel").value = "@nope";
  w.document.getElementById("vidForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 120));

  const last = toasts[toasts.length - 1];
  eq(last.kind, "bad", "the toast must not be a success");
  assert(/no channel with that id/i.test(last.msg), `unhelpful: ${last.msg}`);
  assert(/YouTube has no channel/.test(w.document.getElementById("vidSync").textContent),
         "and the reason should stay on screen after the toast has gone");
});

await check("a good save reports how many it found", async () => {
  const { w, toasts, sent } = await boot(payload({
    checked: { ok: true, count: 4, title: "Thauma" },
  }));
  await openTab(w);
  w.document.getElementById("vidChannel").value = "@thauma";
  w.document.getElementById("vidCount").value = "5";
  w.document.getElementById("vidForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 120));

  const post = sent.find((s) => s.method === "POST");
  eq(post.body.channel, "@thauma", "sends what was typed, unresolved");
  eq(post.body.max_items, 5, "sends the count");
  eq(post.body.is_public, true, "sends the switch");

  const last = toasts[toasts.length - 1];
  eq(last.kind, "good", "kind");
  assert(/4/.test(last.msg), `the count should be substituted, got "${last.msg}"`);
  assert(!/\{n\}/.test(last.msg), `an unsubstituted placeholder reached the screen: ${last.msg}`);
});

await check("no message on this screen ever shows a raw {placeholder}", async () => {
  /* This has happened twice. Both times a string with {n} in it was passed to
     tr() instead of fill(), and both times it reached a person's screen. */
  const { w, toasts } = await boot(payload({ checked: { ok: true, count: 2 } }));
  await openTab(w);
  press(w, w.document.getElementById("vidCheck"));
  await new Promise((r) => setTimeout(r, 120));

  const text = w.document.getElementById("vidForm").parentElement.textContent +
               toasts.map((t) => t.msg).join(" ") +
               w.document.getElementById("vidSync").textContent;
  const stray = text.match(/\{[a-z]+\}/gi);
  eq(stray, null, `unsubstituted placeholders on screen: ${stray}`);
});

await check("Check now re-reads the STORED channel, sending no address", async () => {
  /* If this button posted whatever is in the field, it would be a way to make
     the Worker fetch a URL of the caller's choosing. It sends an action and
     nothing else; the server re-reads the channel it stored. */
  const { w, sent } = await boot();
  await openTab(w);
  w.document.getElementById("vidChannel").value = "http://169.254.169.254/";
  press(w, w.document.getElementById("vidCheck"));
  await new Promise((r) => setTimeout(r, 120));

  const post = sent.find((s) => s.method === "POST");
  eq(post.body.action, "check", "action");
  eq(post.body.channel, undefined, "MUST NOT send the field's contents");
});

await check("with no channel set, Check and Remove are not offered", async () => {
  const { w } = await boot(payload({ channel: null, videos: [] }));
  await openTab(w);
  eq(w.document.getElementById("vidCheck").hidden, true, "Check now");
  eq(w.document.getElementById("vidClear").hidden, true, "Remove");
  eq(w.document.getElementById("vidFound").hidden, true, "the found line");
  eq(w.document.getElementById("vidSync").hidden, true, "the sync line");
});

await check("removing the channel asks first, and does nothing if refused", async () => {
  const { w, sent } = await boot();
  await openTab(w);
  w.StaffConfirm = async () => false;
  press(w, w.document.getElementById("vidClear"));
  await new Promise((r) => setTimeout(r, 120));
  eq(sent.filter((s) => s.method === "DELETE").length, 0, "refused, so nothing sent");

  w.StaffConfirm = async () => true;
  press(w, w.document.getElementById("vidClear"));
  await new Promise((r) => setTimeout(r, 120));
  eq(sent.filter((s) => s.method === "DELETE").length, 1, "confirmed, so sent");
});

/* ---------------------------- the button rail ---------------------------- */

await check("saved buttons come back into the editor", async () => {
  const { w } = await boot(payload({ links: [
    { label: "All updates on YouTube", url: "https://www.youtube.com/@thauma" },
    { label: "Give", url: "https://thauma.one/give" },
  ] }));
  await openTab(w);
  const rows = w.document.querySelectorAll("#vidLinks .vid-link-row");
  eq(rows.length, 2, "rows");
  eq(rows[0].querySelector('[data-vl="label"]').value, "All updates on YouTube", "label");
  eq(rows[1].querySelector('[data-vl="url"]').value, "https://thauma.one/give", "url");
});

await check("the whole rail is sent on save, so removing one removes it", async () => {
  /* Replaced wholesale rather than diffed. Deleting a row and saving must be
     the thing that removes it — if the browser sent only what it had ADDED,
     a deleted button would live on in the database and keep appearing. */
  const { w, sent } = await boot(payload({ links: [
    { label: "Keep", url: "https://a.example" },
    { label: "Drop", url: "https://b.example" },
  ] }));
  await openTab(w);
  w.document.querySelectorAll("#vidLinks .vid-link-row")[1]
    .querySelector('[data-vl="del"]')
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  w.document.getElementById("vidForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 120));

  const post = sent.find((s) => s.method === "POST");
  deq(post.body.links, [{ label: "Keep", url: "https://a.example" }], "the rail as it now stands");
});

await check("a typed button reaches the request exactly as typed", async () => {
  const { w, sent } = await boot();
  await openTab(w);
  press(w, w.document.getElementById("vidLinkAdd"));
  const row = w.document.querySelector("#vidLinks .vid-link-row");
  row.querySelector('[data-vl="label"]').value = "  Newsletter  ";
  row.querySelector('[data-vl="url"]').value = "https://thauma.one/news";
  w.document.getElementById("vidForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 120));

  const post = sent.find((s) => s.method === "POST");
  deq(post.body.links, [{ label: "Newsletter", url: "https://thauma.one/news" }],
      "trimmed, and nothing else changed");
});

await check("the Add control stops at four", async () => {
  const { w } = await boot();
  await openTab(w);
  for (let i = 0; i < 6; i++) {
    if (!w.document.getElementById("vidLinkAdd").hidden) {
      press(w, w.document.getElementById("vidLinkAdd"));
    }
  }
  eq(w.document.querySelectorAll("#vidLinks .vid-link-row").length, 4, "rows");
  eq(w.document.getElementById("vidLinkAdd").hidden, true, "Add should be gone");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
