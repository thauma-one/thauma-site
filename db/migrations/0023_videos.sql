-- 0023_videos.sql — the latest videos from a YouTube channel, cached here
--
-- WHY THAUMA HOLDS THIS AT ALL. chaseroush.com already syncs its own channel:
-- three Netlify functions, a PubSubHubbub subscription, and a JSON file in R2.
-- That works, and it is the last piece of that site's data that Thauma is not
-- the record for. Moving it here means a partner site asks ONE endpoint for
-- everything it renders, and a second partner gets videos by filling in a
-- field rather than by someone porting three functions.
--
-- NO API KEY, DELIBERATELY. YouTube publishes every channel as an Atom feed at
--   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
-- which needs no key, no quota and no billing relationship. The Data API would
-- give richer metadata and a per-project quota to run out of on the day a
-- video actually matters. The feed carries the fifteen most recent videos,
-- which is more than any page here shows.
--
-- KEYED BY CHANNEL, NOT BY PARTNER. Two partners may point at the same
-- channel — an org channel a sending partner also features — and if this
-- table were partner-scoped that would mean two copies fetched twice and
-- capable of disagreeing. A video belongs to a channel; the partner link
-- lives in video_channels, one hop away. It also sidesteps the NULL-partner
-- primary key problem: the organisation is a row in video_channels like
-- everyone else, and no row here has to represent "no partner".
--
-- PUBLIC DATA, and worth saying out loud because most tables here are not.
-- Every column below is already visible to anyone who opens the channel. That
-- is what makes it safe to hand to the partner API, and it is why nothing in
-- this file may ever grow a column about a VIEWER.

CREATE TABLE video_channels (
  -- NULL is the ORGANISATION, the convention used throughout this schema —
  -- so thauma.one's own channel is a row here rather than a deploy variable.
  partner_id    TEXT PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,

  -- The UC... id, not the @handle and not the vanity URL. Handles are
  -- resolved to this when the field is saved, because a handle can be changed
  -- by its owner and a channel id cannot.
  channel_id    TEXT NOT NULL,

  -- What the feed calls the channel. Displayed so somebody who pasted an id
  -- can see they pasted the right one.
  channel_title TEXT,

  -- Off by default, like every other publishing switch here. A channel that
  -- has never synced has nothing to show, and an empty video shelf on a
  -- partner site looks broken rather than new.
  is_public     INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),

  -- How many the partner API and the widget return. The feed holds fifteen.
  max_items     INTEGER NOT NULL DEFAULT 3
                CHECK (max_items BETWEEN 1 AND 15),

  -- Bookkeeping for the sync, shown in the console so "why is this stale"
  -- has an answer that does not require reading logs. sync_error holds the
  -- LAST failure and is cleared by the next success — a channel that was
  -- renamed or deleted otherwise just stops updating silently.
  synced_at     TEXT,
  sync_error    TEXT,

  updated_at    TEXT NOT NULL
);

-- SQLite allows a NULL primary key, which is what lets the organisation have
-- a row here at all. This index keeps that to ONE row; without it two
-- "no partner" rows could exist and the sync would pick one at random.
CREATE UNIQUE INDEX idx_video_channels_org
  ON video_channels ((partner_id IS NULL)) WHERE partner_id IS NULL;

CREATE TABLE videos (
  channel_id   TEXT NOT NULL,
  video_id     TEXT NOT NULL,
  title        TEXT NOT NULL,
  published_at TEXT NOT NULL,

  -- When we last saw it in the feed. A video that drops out of the feed is
  -- deleted rather than left behind, so this is mostly a debugging aid.
  fetched_at   TEXT NOT NULL,

  PRIMARY KEY (channel_id, video_id)
);

-- The one read this table gets: newest first, for one channel.
CREATE INDEX idx_videos_channel ON videos (channel_id, published_at DESC);
