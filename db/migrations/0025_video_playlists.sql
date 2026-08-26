-- 0025_video_playlists.sql — a partner's videos may come from a PLAYLIST
--
-- WHY. A channel is the wrong unit for a sending organisation. Thauma has one
-- channel; the partners on it will each want their own shelf, and asking every
-- partner to run a separate YouTube channel to get one is backwards. A
-- playlist per partner is the natural shape: one channel, curated per
-- ministry, and a partner can be handed edit rights on their own playlist
-- without being handed the channel.
--
-- IT COSTS NOTHING TO READ. The same keyless Atom endpoint takes playlist_id
-- instead of channel_id and returns a byte-identical document — verified
-- against a real playlist before this was written, which is why the feed
-- parser is untouched by this migration.
--
-- THE RENAMES ARE THE POINT OF THIS FILE. A column called `channel_id` holding
-- "PLryve-LPyY0x5F6..." is the kind of lie that costs somebody an hour a year
-- from now, and the table called `video_channels` would be describing half of
-- what it holds. SQLite rewrites the indexes that reference a renamed column,
-- so nothing else here has to change.
--
-- SAFE TO RUN AGAINST DATA. `source_kind` defaults to 'channel', which is what
-- every existing row is.

ALTER TABLE video_channels RENAME TO video_sources;
ALTER TABLE video_sources RENAME COLUMN channel_id TO source_id;
ALTER TABLE video_sources RENAME COLUMN channel_title TO source_title;

-- 'channel' or 'playlist'. Not a boolean: a boolean called `is_playlist` reads
-- fine until the day there is a third kind, and this is a field whose whole
-- job is to name which URL to build.
ALTER TABLE video_sources ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'channel'
  CHECK (source_kind IN ('channel', 'playlist'));

ALTER TABLE videos RENAME COLUMN channel_id TO source_id;

-- Both indexes survive the rename with their old names, which would leave two
-- objects called "video_channels_*" on a table that no longer exists by that
-- name. Recreated so nothing in the schema still says "channel" about a row
-- that may hold a playlist.
DROP INDEX IF EXISTS idx_videos_channel;
CREATE INDEX idx_videos_source ON videos (source_id, published_at DESC);

-- SQLite allows a NULL primary key, which is what lets the organisation have
-- a row here. This keeps that to ONE row; without it two "no partner" rows
-- could exist and the sync would pick one at random.
DROP INDEX IF EXISTS idx_video_channels_org;
CREATE UNIQUE INDEX idx_video_sources_org
  ON video_sources ((partner_id IS NULL)) WHERE partner_id IS NULL;
