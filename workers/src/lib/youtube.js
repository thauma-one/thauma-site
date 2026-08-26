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
 * A playlist id. Several prefixes are real: PL is a playlist somebody made,
 * UU is a channel's automatic uploads list, OLAK is an album, and LL/FL/RD are
 * generated. The length varies by era — old playlists are short — so this is
 * bounded rather than exact, and every character it admits is URL-safe.
 */
export const PLAYLIST_ID_RE = /^(?:PL|UU|OL|LL|FL|RD)[A-Za-z0-9_-]{10,48}$/;

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

/**
 * The feed for a source.
 *
 * ONE ENDPOINT, TWO QUERY PARAMETERS. `playlist_id` returns a document
 * byte-identical in shape to the channel one — same Atom, same yt:videoId,
 * same published — which is why parseFeed is untouched by playlists. Verified
 * against a real playlist rather than assumed.
 */
export function feedUrl(kind, id) {
  if (kind === "playlist") {
    if (!PLAYLIST_ID_RE.test(id)) throw new Error("not a playlist id");
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`;
  }
  if (!CHANNEL_ID_RE.test(id)) throw new Error("not a channel id");
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

/** Where a human goes to look at the source itself. */
export function sourceUrl(kind, id) {
  return kind === "playlist"
    ? `https://www.youtube.com/playlist?list=${id}`
    : `https://www.youtube.com/channel/${id}`;
}

/** Where a video lives, and its poster. Derived, so neither is stored. */
export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
export function thumbUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Turn whatever somebody pasted into a source: a channel or a playlist.
 *
 * Returns `{ kind, id }`, kind being "channel" or "playlist".
 *
 * ONE FIELD, NOT TWO, AND NO PICKER. Nobody thinks "I am supplying a playlist
 * identifier" — they copy what is in the address bar. A dropdown asking which
 * kind they pasted is a question the string already answers: a playlist URL
 * carries list=, a channel URL does not.
 *
 * PLAYLISTS ARE CHECKED FIRST, because a playlist URL usually names a channel
 * too. https://www.youtube.com/watch?v=X&list=PL... has both in it, and
 * somebody who copied that address while looking at a playlist meant the
 * playlist.
 *
 * A HANDLE COSTS A PAGE FETCH. There is no keyless endpoint that maps @name to
 * a channel id, so the channel page is fetched and the id read out of it. That
 * is scraping, and it will break the day YouTube changes that markup — which
 * is why it is confined to this function, runs only when SAVING a source
 * rather than on every sync, and fails with a message telling the person where
 * to find the id by hand. The stored value is always the durable id.
 */
export async function resolveSource(input, fetchImpl = fetch) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Enter a YouTube address, or a channel or playlist id.");

  /* Pasted bare. */
  if (PLAYLIST_ID_RE.test(raw)) return { kind: "playlist", id: raw };
  if (CHANNEL_ID_RE.test(raw)) return { kind: "channel", id: raw };

  /* In a URL. `list=` wins — see the note above. */
  const inList = raw.match(/[?&]list=([A-Za-z0-9_-]{12,50})/);
  if (inList && PLAYLIST_ID_RE.test(inList[1])) {
    return { kind: "playlist", id: inList[1] };
  }
  const inUrl = raw.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (inUrl) return { kind: "channel", id: inUrl[1] };

  /* @handle, youtube.com/@handle, /c/name, /user/name — all end up as a page
     to load. Anything else is rejected before a request is made, so this
     cannot be pointed at an arbitrary host. */
  let path = "";
  const handle = raw.match(/^@?([A-Za-z0-9._-]{3,30})$/);
  const urlish = raw.match(/youtube\.com\/((?:@|c\/|user\/)[A-Za-z0-9._-]{1,60})/);
  if (urlish) path = urlish[1];
  else if (handle) path = "@" + handle[1];
  else {
    throw new Error(
      "That does not look like a YouTube channel or playlist. Paste the web " +
      "address from your browser while looking at the one you want.");
  }

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
  return { kind: "channel", id: found[1] };
}
