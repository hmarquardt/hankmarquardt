PRAGMA foreign_keys = ON;

-- A single private library. Sessions are opaque and only their hashes are stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  owner_key_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'staging' CHECK(status IN ('staging', 'complete', 'abandoned')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL UNIQUE REFERENCES imports(id),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INTEGER,
  artwork_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  track_number INTEGER NOT NULL,
  disc_number INTEGER NOT NULL DEFAULT 1,
  duration REAL NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  uploaded INTEGER NOT NULL DEFAULT 0 CHECK(uploaded IN (0,1))
);
CREATE INDEX tracks_album ON tracks(album_id, disc_number, track_number);
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  position INTEGER NOT NULL,
  PRIMARY KEY(playlist_id, position)
);
CREATE TABLE listening_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
