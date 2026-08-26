/**
 * video-sync.js — bring the `videos` table in line with a channel's feed
 *
 * ONE FUNCTION, CALLED FROM TWO PLACES: the scheduled run every quarter hour,
 * and the console's "Check now" button. Both do exactly the same thing, which
 * is the point — the button is how somebody confirms the channel is right
 * without waiting for a cron, so it must not be a second implementation that
 * can succeed where the real one fails.
 *
 * A FAILED SYNC KEEPS THE OLD VIDEOS. YouTube being slow, or a feed being
 * briefly malformed, must not empty a partner's video shelf: a stale video is
 * a small problem and a blank section is a broken-looking website. The failure
 * is recorded on the channel instead, where the console shows it.
 *
 * WHICH MAKES PRUNING THE DELICATE PART. A video deleted or made private on
 * YouTube has to disappear from here too — that is somebody's decision about
 * their own work and this cache does not get to override it. So rows not seen
 * in the current run are deleted, but ONLY once the response has been
 * confirmed to be a real feed. "Zero entries" and "we could not read it" look
 * identical if you only count entries, and treating the second as the first
 * would delete everything on a bad afternoon.
 */
import { parseFeed, parseChannelTitle, feedUrl, CHANNEL_ID_RE, PLAYLIST_ID_RE }
  from "./youtube.js";

/** Not a limit on what YouTube sends — the feed holds fifteen — but a bound
    on what a surprise can make us write in one pass. */
const MAX_PER_SYNC = 15;

export async function syncSource(db, source, { fetchImpl = fetch, now } = {}) {
  const stamp = now || new Date().toISOString();
  const partner_id = source.partner_id ?? null;
  const source_id = source.source_id;
  const kind = source.source_kind === "playlist" ? "playlist" : "channel";
  const shaped = kind === "playlist" ? PLAYLIST_ID_RE : CHANNEL_ID_RE;

  if (!shaped.test(source_id || "")) {
    await db.query("video_source_failed", {
      partner_id, now: stamp, error: `That ${kind} id is not the right shape.`,
    });
    return { ok: false, error: `bad ${kind} id`, count: 0 };
  }

  let body;
  try {
    const res = await fetchImpl(feedUrl(kind, source_id), {
      headers: { Accept: "application/atom+xml, application/xml" },
    });
    if (!res.ok) {
      /* 404 is the one worth naming: it almost always means the source was
         deleted or the id was mistyped, and "HTTP 404" sends somebody to a
         search engine while this sends them to the field they need to fix.

         For a playlist it means one more thing, and it is the thing somebody
         will actually hit: a PRIVATE playlist answers 404 here. Unlisted is
         fine — unlisted means anyone with the link, and this is a link. */
      const why = res.status === 404
        ? (kind === "playlist"
            ? "YouTube has no playlist with that id, or it is set to Private. " +
              "Unlisted works; Private cannot be read by anything but your own account."
            : "YouTube has no channel with that id.")
        : `YouTube returned ${res.status}.`;
      await db.query("video_source_failed", { partner_id, now: stamp, error: why });
      return { ok: false, error: why, count: 0 };
    }
    body = await res.text();
  } catch (err) {
    const why = `Could not reach YouTube: ${err.message}`;
    await db.query("video_source_failed", { partner_id, now: stamp, error: why });
    return { ok: false, error: why, count: 0 };
  }

  /* THE GUARD THE PRUNE DEPENDS ON. Anything that is not recognisably an Atom
     feed is a failure, even though it arrived with a 200 — a captive portal,
     a consent interstitial and an error page all do that. */
  if (!/<feed\b/i.test(body)) {
    const why = "YouTube sent something that is not a video feed.";
    await db.query("video_source_failed", { partner_id, now: stamp, error: why });
    return { ok: false, error: why, count: 0 };
  }

  const videos = parseFeed(body).slice(0, MAX_PER_SYNC);
  for (const v of videos) {
    await db.query("video_upsert", {
      source_id,
      video_id: v.videoId,
      title: v.title,
      published_at: v.published,
      now: stamp,
    });
  }

  /* Safe now: the response was a feed, so an empty one means an empty source.
     Everything the run just touched carries `stamp`. */
  await db.query("videos_prune", { source_id, now: stamp });
  await db.query("video_source_synced", { partner_id, now: stamp });

  /* For a playlist this is the PLAYLIST's name, not the channel's — the feed
     puts it in the same place, which is what makes one parser enough. It is
     shown back in the console as the confirmation that the right thing was
     found, so "Mission Updates" is exactly the right answer there. */
  return { ok: true, count: videos.length, title: parseChannelTitle(body), kind };
}

/**
 * The scheduled pass over every switched-on channel.
 *
 * Sequential, not Promise.all. There will be a handful of channels for years,
 * a scheduled Worker has a CPU budget, and firing every request at YouTube
 * simultaneously from one IP is how a keyless public feed starts refusing to
 * answer. One failure never stops the run — that is the whole reason each
 * channel records its own error.
 */
export async function syncAll(db, opts = {}) {
  const sources = await db.query("video_sources_all", {});
  const results = [];
  for (const c of sources) {
    try {
      results.push({ partner_id: c.partner_id, ...(await syncSource(db, c, opts)) });
    } catch (err) {
      /* syncSource records its own failures; reaching here means something
         unforeseen, and the next source still deserves its turn. */
      console.error("video sync threw for", c.partner_id, err);
      results.push({ partner_id: c.partner_id, ok: false, error: err.message, count: 0 });
    }
  }
  return results;
}
