/**
 * youtube.js — read a channel's public feed, without an API key
 *
 * WHAT THIS TALKS TO. One URL:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 * It is public, unauthenticated, unmetered, and returns the fifteen most
 * recent videos as Atom. No Data API key, no quota to exhaust, no project to
 * attach to a billing account.
 *
 * WHY NOT AN XML PARSER. Workers have no DOMParser, and pulling one in to read
 * six fields from a feed whose shape has not changed in a decade is a lot of
 * bundle for very little. The extraction below is per-ENTRY rather than
 * per-document, which is the part that actually matters: chaseroush.com's
 * version takes "the second <title> in the file" and is one feed-format tweak
 * away from labelling every video with the channel's name.
 *
 * ENTITIES ARE DECODED. A video called "Faith & Works" arrives as
 * "Faith &amp; Works", and a title is written into HTML and into emails
 * downstream. Decoding here, once, means every consumer gets the real title;
 * escaping on the way OUT is still each consumer's job.
 */

/** Everything the feed can legally contain, plus numeric forms. */
export function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    /* LAST, or "&amp;lt;" would decode twice and produce a "<" the channel
       owner never typed. */
    .replace(/&amp;/g, "&");
}

/* Out-of-range code points throw; a bad entity should cost one character,
   not the whole sync. */
function cp(n) {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

/** A YouTube channel id: "UC" and 22 more characters of base64url. */
export const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Every video in a channel feed, newest first.
 *
 * Returns [] for anything unparseable rather than throwing — a malformed feed
 * is a reason to keep yesterday's videos and record an error, not a reason for
 * the scheduled run to stop before it reaches the next channel.
 */
export function parseFeed(xml) {
  const body = String(xml || "");
  const out = [];

  for (const chunk of body.split("<entry>").slice(1)) {
    const entry = chunk.split("</entry>")[0];
    const videoId = tag(entry, "yt:videoId");
    /* Video ids go straight into URLs and into a database key. Anything that
       is not the documented shape is skipped rather than sanitised, because a
       feed that contains a surprise here is not a feed to trust. */
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;

    const title = tag(entry, "title");
    const published = tag(entry, "published") || tag(entry, "updated");
    if (!title || !published) continue;

    out.push({ videoId, title, published });
  }

  /* The feed is already newest-first, but that is a promise nobody made in
     writing, and the whole point of this data is "the latest one". */
  out.sort((a, b) => (a.published < b.published ? 1 : -1));
  return out;
}

/** The channel's own name, which is the first <title> — outside any entry. */
export function parseChannelTitle(xml) {
  const head = String(xml || "").split("<entry>")[0];
  return tag(head, "title");
}

export function feedUrl(channelId) {
  if (!CHANNEL_ID_RE.test(channelId)) throw new Error("not a channel id");
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/** Where a video lives, and its poster. Derived, so neither is stored. */
export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
export function thumbUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Turn whatever somebody pasted into a channel id.
 *
 * Accepts the id itself, a /channel/UC... URL, an @handle, a /c/ or /user/
 * vanity URL — because "the channel" means the address bar to most people, and
 * refusing everything but a 24-character string they have never seen is a
 * support conversation rather than a feature.
 *
 * A HANDLE COSTS A PAGE FETCH. There is no keyless endpoint that maps @name to
 * a channel id, so the channel page is fetched and the id read out of it. That
 * is scraping, and it will break the day YouTube changes that markup — which
 * is why it is confined to this function, runs only when SAVING a channel
 * rather than on every sync, and fails with a message telling the person where
 * to find the id by hand. The stored value is always the durable id.
 */
export async function resolveChannelId(input, fetchImpl = fetch) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Enter a channel address or id.");

  if (CHANNEL_ID_RE.test(raw)) return raw;

  const inUrl = raw.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (inUrl) return inUrl[1];

  /* @handle, youtube.com/@handle, /c/name, /user/name — all end up as a page
     to load. Anything else is rejected before a request is made, so this
     cannot be pointed at an arbitrary host. */
  let path = "";
  const handle = raw.match(/^@?([A-Za-z0-9._-]{3,30})$/);
  const urlish = raw.match(/youtube\.com\/((?:@|c\/|user\/)[A-Za-z0-9._-]{1,60})/);
  if (urlish) path = urlish[1];
  else if (handle) path = "@" + handle[1];
  else throw new Error("That does not look like a YouTube channel. Paste the channel's web address, or its id.");

  const res = await fetchImpl(`https://www.youtube.com/${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; thauma.one)" },
  });
  if (!res.ok) {
    throw new Error(`No channel found at ${path}. Check the address, or paste the channel id instead.`);
  }

  /* Only the first stretch of the page is read. The id appears in the head
     metadata; the rest is a megabyte of player state that would otherwise be
     pulled into a Worker's memory for nothing. */
  const head = (await res.text()).slice(0, 400_000);
  const found = head.match(/"(?:channelId|externalId)":"(UC[A-Za-z0-9_-]{22})"/)
    || head.match(/channel_id=(UC[A-Za-z0-9_-]{22})/)
    || head.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (!found) {
    throw new Error(
      "Found the page but could not read the channel id from it. Open the " +
      "channel, choose Share, and paste the address it gives you.");
  }
  return found[1];
}
