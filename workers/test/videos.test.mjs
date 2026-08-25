#!/usr/bin/env node
/**
 * Videos — reading a channel's feed, and the two ways it can go wrong
 *   node workers/test/videos.test.mjs
 *
 * The interesting behaviour here is not "does it parse XML". It is what
 * happens when it CANNOT: a partner site's video shelf must survive YouTube
 * having a bad afternoon, and must not survive a video being deleted. Those
 * two pull in opposite directions and most of this file is about the line
 * between them.
 */
import { parseFeed, parseChannelTitle, decodeEntities, resolveChannelId, feedUrl }
  from "../src/lib/youtube.js";
import { syncChannel, syncAll } from "../src/lib/video-sync.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const CHANNEL = "UCnp-pBzHdpTwMonf7xuN1Ug";

function feed(entries, title = "Thauma") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>${title}</title>
  <yt:channelId>${CHANNEL}</yt:channelId>
  ${entries.map((e) => `<entry>
    <id>yt:video:${e.id}</id>
    <yt:videoId>${e.id}</yt:videoId>
    <title>${e.title}</title>
    <published>${e.published}</published>
  </entry>`).join("\n")}
</feed>`;
}

const A = { id: "dQw4w9WgXcQ", title: "Newest", published: "2026-08-01T10:00:00+00:00" };
const B = { id: "aBcDeFgHiJk", title: "Older",  published: "2026-07-01T10:00:00+00:00" };

/** A database that records every write, so the tests can assert on them. */
function fakeDb(rows = {}) {
  const calls = [];
  return {
    calls,
    async query(name, params = {}) {
      calls.push({ name, params });
      if (name === "video_channels_all") return rows.channels || [];
      return [];
    },
    async queryOne(name, params) {
      calls.push({ name, params });
      return rows.one ?? null;
    },
    named(name) { return calls.filter((c) => c.name === name); },
  };
}

const okFetch = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300, status, text: async () => body,
});

/* ------------------------------- parsing -------------------------------- */

await check("the channel's name is not mistaken for a video's", async () => {
  /* chaseroush.com's parser takes "the second <title> in the document",
     which is only correct while the channel title happens to come first and
     every entry happens to have exactly one. Parsing per entry is what makes
     this hold when either stops being true. */
  const xml = feed([A, B], "Chase &amp; Kelsey");
  eq(parseChannelTitle(xml), "Chase & Kelsey", "channel title");
  eq(parseFeed(xml).map((v) => v.title), ["Newest", "Older"], "video titles");
});

await check("entities are decoded once, never twice", async () => {
  eq(decodeEntities("Faith &amp; Works"), "Faith & Works", "ampersand");
  eq(decodeEntities("&#8212; dash"), "— dash", "numeric");
  eq(decodeEntities("&#x2014; dash"), "— dash", "hex");
  /* If &amp; were decoded first, this would come out as real angle brackets —
     a title the channel owner never typed, injected into every consumer that
     renders it. */
  eq(decodeEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;", "no double decode");
});

await check("a video id that is not a video id is skipped", async () => {
  /* The id becomes part of a URL and part of a primary key. Anything off-shape
     is dropped rather than cleaned up: a feed containing a surprise here is
     not a feed to be creative with. */
  const xml = feed([A, { id: "../../etc", title: "Bad", published: "2026-09-01T00:00:00Z" }]);
  eq(parseFeed(xml).map((v) => v.videoId), [A.id], "only the real one");
});

await check("videos come back newest first whatever order they arrive in", async () => {
  eq(parseFeed(feed([B, A])).map((v) => v.videoId), [A.id, B.id], "sorted");
});

await check("garbage parses to nothing rather than throwing", async () => {
  for (const junk of ["", null, "<html>nope</html>", "{not xml"]) {
    eq(parseFeed(junk), [], `parsed ${JSON.stringify(junk)}`);
  }
});

/* --------------------------- resolving a channel ------------------------- */

await check("an id, a channel URL and a handle all resolve", async () => {
  eq(await resolveChannelId(CHANNEL), CHANNEL, "bare id");
  eq(await resolveChannelId(`https://www.youtube.com/channel/${CHANNEL}/videos`),
     CHANNEL, "channel URL");
  const scraped = okFetch(`<html><meta><script>{"channelId":"${CHANNEL}"}</script>`);
  eq(await resolveChannelId("@thauma", scraped), CHANNEL, "handle");
});

await check("resolving NEVER fetches a host other than youtube.com", async () => {
  /* This function takes a string a person typed and turns it into an outbound
     request. Without this, the console would be a request-forger: paste an
     internal address, have the Worker fetch it. */
  const seen = [];
  const spy = async (u) => { seen.push(u); return okFetch("")(); };
  for (const bad of ["http://169.254.169.254/latest/meta-data/",
                     "https://evil.example/@x",
                     "javascript:alert(1)",
                     "//evil.example"]) {
    let threw = null;
    try { await resolveChannelId(bad, spy); } catch (e) { threw = e.message; }
    assert(threw, `accepted ${bad}`);
  }
  eq(seen, [], "no request should have been made at all");

  const spy2 = [];
  await resolveChannelId("@thauma", async (u) => {
    spy2.push(u);
    return okFetch(`<script>{"channelId":"${CHANNEL}"}</script>`)();
  });
  eq(spy2, ["https://www.youtube.com/@thauma"], "the one host it may reach");
});

await check("feedUrl refuses anything that is not a channel id", async () => {
  let threw = null;
  try { feedUrl("../../../evil"); } catch (e) { threw = e.message; }
  assert(threw, "built a feed URL from junk");
});

/* ------------------------------- syncing --------------------------------- */

const CH = { partner_id: "p_chase", channel_id: CHANNEL };

await check("a good sync stores the videos and clears the error", async () => {
  const db = fakeDb();
  const r = await syncChannel(db, CH, { fetchImpl: okFetch(feed([A, B])), now: "T2" });
  eq(r.ok, true, "ok");
  eq(r.count, 2, "count");
  eq(db.named("video_upsert").map((c) => c.params.video_id), [A.id, B.id], "stored");
  eq(db.named("video_channel_synced").length, 1, "marked synced");
  eq(db.named("video_channel_failed").length, 0, "no failure recorded");
});

await check("a failed fetch KEEPS the videos it already had", async () => {
  /* The point of the whole cache. YouTube being slow must not empty a live
     website's video shelf — a stale video is a small problem and a blank
     section looks broken. */
  for (const [label, impl] of [
    ["500", okFetch("nope", 500)],
    ["network", async () => { throw new Error("connection reset"); }],
    ["not a feed", okFetch("<html>are you a robot?</html>")],
  ]) {
    const db = fakeDb();
    const r = await syncChannel(db, CH, { fetchImpl: impl, now: "T2" });
    eq(r.ok, false, `${label}: reported failure`);
    eq(db.named("videos_prune").length, 0, `${label}: MUST NOT prune`);
    eq(db.named("video_upsert").length, 0, `${label}: wrote nothing`);
    eq(db.named("video_channel_failed").length, 1, `${label}: recorded why`);
  }
});

await check("an EMPTY but valid feed does prune, because that is a real answer", async () => {
  /* The other side of the line above. A channel whose videos were deleted has
     genuinely returned zero, and continuing to publish them would override
     somebody's decision about their own work. What separates this from the
     failures above is that the response is recognisably a feed. */
  const db = fakeDb();
  const r = await syncChannel(db, CH, { fetchImpl: okFetch(feed([])), now: "T2" });
  eq(r.ok, true, "a feed with no entries is a success");
  eq(db.named("videos_prune").length, 1, "pruned");
});

await check("pruning removes only what this run did not touch", async () => {
  const db = fakeDb();
  await syncChannel(db, CH, { fetchImpl: okFetch(feed([A])), now: "T2" });
  eq(db.named("video_upsert")[0].params.now, "T2", "the survivor is stamped now");
  eq(db.named("videos_prune")[0].params.now, "T2", "and the prune cuts below it");
});

await check("a 404 says the channel is missing, not 'HTTP 404'", async () => {
  const db = fakeDb();
  const r = await syncChannel(db, CH, { fetchImpl: okFetch("", 404), now: "T2" });
  assert(/no channel with that id/i.test(r.error), `unhelpful: ${r.error}`);
});

await check("a malformed channel id never reaches the network", async () => {
  let touched = false;
  const db = fakeDb();
  const r = await syncChannel(db, { partner_id: "p", channel_id: "'; DROP TABLE videos--" },
    { fetchImpl: async () => { touched = true; return okFetch("")(); }, now: "T2" });
  eq(r.ok, false, "refused");
  eq(touched, false, "no request made");
});

await check("one bad channel does not stop the scheduled run", async () => {
  /* A cron has nobody to tell. If the first channel throwing ended the pass,
     every partner after it would silently stop updating. */
  const db = fakeDb({ channels: [
    { partner_id: "p_a", channel_id: CHANNEL },
    { partner_id: "p_b", channel_id: CHANNEL },
    { partner_id: null,  channel_id: CHANNEL },
  ] });
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n === 1) throw new Error("first one fails");
    return okFetch(feed([A]))();
  };
  const results = await syncAll(db, { fetchImpl: flaky, now: "T2" });
  eq(results.length, 3, "every channel was attempted");
  eq(results.map((r) => r.ok), [false, true, true], "the failure is isolated");
  eq(results[2].partner_id, null, "the organisation is a channel like any other");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
