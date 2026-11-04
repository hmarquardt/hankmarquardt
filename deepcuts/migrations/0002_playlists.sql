PRAGMA foreign_keys = ON;

-- Additive only: the foundation already created both playlist tables. These
-- indexes make ordering lookups cheap and keep a track unique per playlist.
CREATE UNIQUE INDEX IF NOT EXISTS playlist_tracks_unique_track
  ON playlist_tracks(playlist_id, track_id);
CREATE INDEX IF NOT EXISTS playlist_tracks_track
  ON playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS playlists_created
  ON playlists(created_at);
