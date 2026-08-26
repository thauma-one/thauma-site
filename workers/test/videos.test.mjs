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
import { parseFeed, parseChannelTitle, decodeEntities, resolveSource, feedUrl,
         sourceUrl } from "../src/lib/youtube.js";
import { syncSource, syncAll } from "../src/lib/video-sync.js";
import { safeUrl, cleanLinks } from "../src/staff-videos.js";

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
      if (name === "video_sources_all") return rows.channels || [];
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

const PLAYLIST = "PLryve-LPyY0x5F6-uVcT0K3giNi9dXvaW";

await check("an id, a channel URL and a handle all resolve", async () => {
  eq(await resolveSource(CHANNEL), { kind: "channel", id: CHANNEL }, "bare id");
  eq(await resolveSource(`https://www.youtube.com/channel/${CHANNEL}/videos`),
     { kind: "channel", id: CHANNEL }, "channel URL");
  const scraped = okFetch(`<html><meta><script>{"channelId":"${CHANNEL}"}</script>`);
  eq(await resolveSource("@thauma", scraped), { kind: "channel", id: CHANNEL }, "handle");
});

await check("a playlist is recognised from every address it appears in", async () => {
  const want = { kind: "playlist", id: PLAYLIST };
  eq(await resolveSource(PLAYLIST), want, "bare id");
  eq(await resolveSource(`https://www.youtube.com/playlist?list=${PLAYLIST}`), want, "playlist page");
  /* THE ONE THAT MATTERS. Somebody watching a playlist copies the address bar,
     and it names a video AND a channel AND the playlist. They meant the
     playlist — so `list=` is checked before anything else. */
  eq(await resolveSource(
    `https://www.youtube.com/watch?v=RXtiA_2rXok&list=${PLAYLIST}&index=2`),
    want, "watching inside a playlist");
});

await check("resolving a playlist NEVER costs a network request", async () => {
  /* Only a handle needs the page fetched. A playlist id is in the string. */
  let touched = false;
  await resolveSource(`https://www.youtube.com/playlist?list=${PLAYLIST}`,
    async () => { touched = true; return okFetch("")(); });
  eq(touched, false, "a request was made for something already in the URL");
});

await check("the two feed URLs differ only in the parameter", async () => {
  eq(feedUrl("channel", CHANNEL),
     `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`, "channel");
  eq(feedUrl("playlist", PLAYLIST),
     `https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST}`, "playlist");
  eq(sourceUrl("playlist", PLAYLIST),
     `https://www.youtube.com/playlist?list=${PLAYLIST}`, "where a person looks");
});

await check("a playlist id is not accepted where a channel id belongs", async () => {
  /* The ids live in different namespaces and the feed takes a different
     parameter for each. Crossing them would ask YouTube for a channel that
     cannot exist and record a 404 against a perfectly good playlist. */
  for (const [kind, id] of [["channel", PLAYLIST], ["playlist", CHANNEL]]) {
    let threw = null;
    try { feedUrl(kind, id); } catch (e) { threw = e.message; }
    assert(threw, `feedUrl built a ${kind} URL from ${id}`);
  }
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
    try { await resolveSource(bad, spy); } catch (e) { threw = e.message; }
    assert(threw, `accepted ${bad}`);
  }
  eq(seen, [], "no request should have been made at all");

  const spy2 = [];
  await resolveSource("@thauma", async (u) => {
    spy2.push(u);
    return okFetch(`<script>{"channelId":"${CHANNEL}"}</script>`)();
  });
  eq(spy2, ["https://www.youtube.com/@thauma"], "the one host it may reach");
});

await check("feedUrl refuses anything that is not a channel id", async () => {
  let threw = null;
  try { feedUrl("channel", "../../../evil"); } catch (e) { threw = e.message; }
  assert(threw, "built a feed URL from junk");
});

/* ------------------------------- syncing --------------------------------- */

const CH = { partner_id: "p_chase", source_id: CHANNEL, source_kind: "channel" };

await check("a good sync stores the videos and clears the error", async () => {
  const db = fakeDb();
  const r = await syncSource(db, CH, { fetchImpl: okFetch(feed([A, B])), now: "T2" });
  eq(r.ok, true, "ok");
  eq(r.count, 2, "count");
  eq(db.named("video_upsert").map((c) => c.params.video_id), [A.id, B.id], "stored");
  eq(db.named("video_source_synced").length, 1, "marked synced");
  eq(db.named("video_source_failed").length, 0, "no failure recorded");
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
    const r = await syncSource(db, CH, { fetchImpl: impl, now: "T2" });
    eq(r.ok, false, `${label}: reported failure`);
    eq(db.named("videos_prune").length, 0, `${label}: MUST NOT prune`);
    eq(db.named("video_upsert").length, 0, `${label}: wrote nothing`);
    eq(db.named("video_source_failed").length, 1, `${label}: recorded why`);
  }
});

await check("an EMPTY but valid feed does prune, because that is a real answer", async () => {
  /* The other side of the line above. A channel whose videos were deleted has
     genuinely returned zero, and continuing to publish them would override
     somebody's decision about their own work. What separates this from the
     failures above is that the response is recognisably a feed. */
  const db = fakeDb();
  const r = await syncSource(db, CH, { fetchImpl: okFetch(feed([])), now: "T2" });
  eq(r.ok, true, "a feed with no entries is a success");
  eq(db.named("videos_prune").length, 1, "pruned");
});

await check("pruning removes only what this run did not touch", async () => {
  const db = fakeDb();
  await syncSource(db, CH, { fetchImpl: okFetch(feed([A])), now: "T2" });
  eq(db.named("video_upsert")[0].params.now, "T2", "the survivor is stamped now");
  eq(db.named("videos_prune")[0].params.now, "T2", "and the prune cuts below it");
});

await check("a 404 says the channel is missing, not 'HTTP 404'", async () => {
  const db = fakeDb();
  const r = await syncSource(db, CH, { fetchImpl: okFetch("", 404), now: "T2" });
  assert(/no channel with that id/i.test(r.error), `unhelpful: ${r.error}`);
});

await check("a 404 on a PLAYLIST names the one cause somebody will hit", async () => {
  /* Unlisted playlists are readable — unlisted means anyone with the link, and
     the feed is a link. PRIVATE ones answer 404, and that is the distinction
     worth spelling out at the moment it happens rather than leaving somebody
     to work out which of their settings is wrong. */
  const db = fakeDb();
  const r = await syncSource(db,
    { partner_id: "p", source_id: PLAYLIST, source_kind: "playlist" },
    { fetchImpl: okFetch("", 404), now: "T2" });
  assert(/private/i.test(r.error), `should mention Private: ${r.error}`);
  assert(/unlisted/i.test(r.error), `should say unlisted is fine: ${r.error}`);
});

await check("a playlist syncs through the same path as a channel", async () => {
  const db = fakeDb();
  const r = await syncSource(db,
    { partner_id: "p", source_id: PLAYLIST, source_kind: "playlist" },
    { fetchImpl: okFetch(feed([A, B], "Mission Updates")), now: "T2" });
  eq(r.ok, true, "ok");
  eq(r.kind, "playlist", "kind is reported back");
  /* The PLAYLIST's name, not the channel's — the feed puts it in the same
     place, which is what makes one parser enough for both. */
  eq(r.title, "Mission Updates", "title");
  eq(db.named("video_upsert").map((c) => c.params.source_id), [PLAYLIST, PLAYLIST],
     "videos are keyed by the source they came from");
});

await check("a malformed channel id never reaches the network", async () => {
  let touched = false;
  const db = fakeDb();
  const r = await syncSource(db, { partner_id: "p", source_id: "'; DROP TABLE videos--" },
    { fetchImpl: async () => { touched = true; return okFetch("")(); }, now: "T2" });
  eq(r.ok, false, "refused");
  eq(touched, false, "no request made");
});

await check("one bad channel does not stop the scheduled run", async () => {
  /* A cron has nobody to tell. If the first channel throwing ended the pass,
     every partner after it would silently stop updating. */
  const db = fakeDb({ channels: [
    { partner_id: "p_a", source_id: CHANNEL },
    { partner_id: "p_b", source_id: CHANNEL },
    { partner_id: null,  source_id: CHANNEL },
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

/* ------------------------ the optional button rail ----------------------- */

await check("ONLY http AND https EVER BECOME A BUTTON", async () => {
  /* This value becomes an href in a widget on a stranger's website. A
     javascript: URL there is script execution on THEIR page, and data: is a
     whole document of the author's choosing. Refused before it is stored, and
     again in the widget before it is used. */
  for (const good of ["https://www.youtube.com/@thauma", "http://example.org/give",
                      "https://thauma.one/news?utm=1#top"]) {
    assert(safeUrl(good), `refused a real address: ${good}`);
  }
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)",
                     "data:text/html,<script>alert(1)</script>",
                     "vbscript:msgbox", "file:///etc/passwd", "ftp://x.org",
                     /* Relative, and it would point at the HOST's giving page
                        rather than the ministry's — the button renders on
                        somebody else's domain. */
                     "/give", "give", "//evil.example", ""]) {
    eq(safeUrl(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

await check("a button needs both a label and an address", async () => {
  eq(cleanLinks([{ label: "", url: "https://x.org" }]).error !== undefined, true,
     "a nameless button");
  assert(/https/.test(cleanLinks([{ label: "Give", url: "x.org" }]).error || ""),
     "the error should tell them what a full address looks like");
  /* The empty row at the bottom of the editor is not an error — deleting it
     for them is friendlier than refusing the save. */
  eq(cleanLinks([{ label: "", url: "" }]).value.length, 0, "a blank row");
});

await check("two buttons cannot carry the same words", async () => {
  const r = cleanLinks([{ label: "Give", url: "https://a.org" },
                        { label: "give", url: "https://b.org" }]);
  assert(/two buttons/i.test(r.error || ""), `expected a refusal, got ${JSON.stringify(r)}`);
});

await check("the rail is capped server-side, not only in the browser", async () => {
  /* A limit only the browser knows is not a limit. */
  const many = Array.from({ length: 9 }, (_, i) => ({ label: "L" + i, url: "https://x.org/" + i }));
  assert(cleanLinks(many).error, "nine buttons were accepted");
});

await check("order is taken from the rows, not from what was typed in them", async () => {
  const { value } = cleanLinks([{ label: "B", url: "https://b.org" },
                                { label: "A", url: "https://a.org" }]);
  eq(value.map((l) => [l.label, l.sort_order]), [["B", 0], ["A", 1]], "as arranged");
});

await check("links absent from the request leave the stored rail alone", async () => {
  /* Only "Check now" and older clients omit it. Treating a missing field as
     "delete everything" would wipe the rail on every check. */
  eq(cleanLinks(undefined).value, null, "undefined means: not sent");
  eq(cleanLinks(null).value, null, "null means: not sent");
  eq(cleanLinks([]).value.length, 0, "an empty LIST does mean: remove them all");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
