import { useMemo, useState } from "react";
import { Icon } from "./icons";
import {
  formatTime,
  type Album,
  type Playlist,
  type PlaylistSummary,
  type Track,
} from "../shared/model";
import { playlistSummaryText } from "../shared/playlists";
import { useDialogFocus } from "./useDialogFocus";

export function PlaylistCover({
  title,
  className = "",
}: {
  title: string;
  className?: string;
}) {
  return (
    <div className={`cover playlist-cover ${className}`}>
      <div className="playlist-cover-art" aria-hidden="true">
        <Icon name="playlist" size={40} />
        <span>{title}</span>
      </div>
    </div>
  );
}

export function PlaylistCard({
  playlist,
  downloaded,
  onOpen,
}: {
  playlist: PlaylistSummary;
  downloaded: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <article className="album-card playlist-card">
      <button
        className="album-card-link"
        onClick={() => onOpen(playlist.id)}
        aria-label={`Open ${playlist.title}`}
      >
        <div className="cover-wrap">
          <PlaylistCover title={playlist.title} />
          {downloaded && (
            <span className="cover-download" aria-label="On this device">
              <Icon name="download" size={15} />
            </span>
          )}
          <span className="cover-play">
            <Icon name="play" />
          </span>
        </div>
        <h3>{playlist.title}</h3>
        <p>{playlistSummaryText(playlist.track_count, playlist.duration)}</p>
      </button>
    </article>
  );
}

export function Modal({
  label,
  children,
  onClose,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useDialogFocus(true);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={`modal ${wide ? "playlist-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <button
          type="button"
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        {children}
      </section>
    </div>
  );
}

export function PlaylistTitleDialog({
  mode,
  initial = "",
  busy,
  onSubmit,
  onClose,
}: {
  mode: "create" | "rename";
  initial?: string;
  busy: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial);
  return (
    <Modal
      label={mode === "create" ? "New playlist" : "Rename playlist"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="eyebrow">
        {mode === "create" ? "MAKE A NEW MIX" : "CHANGE THE LABEL"}
      </p>
      <h2>{mode === "create" ? "New playlist." : "Rename playlist."}</h2>
      <form
        className="import-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (value && !busy) onSubmit(value);
        }}
      >
        <label>
          Playlist name
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            required
            placeholder="Late night drive"
          />
        </label>
        <button
          className="button primary"
          type="submit"
          disabled={!!busy || !title.trim()}
        >
          <Icon name={mode === "create" ? "plus" : "check"} />
          {busy
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create playlist"
              : "Save name"}
        </button>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      label={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="eyebrow">THIS ONLY CHANGES THE PLAYLIST</p>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <div className="confirm-actions">
        <button
          className="button"
          type="button"
          onClick={onClose}
          disabled={!!busy}
        >
          Keep playlist
        </button>
        <button
          className="button primary"
          type="button"
          onClick={onConfirm}
          disabled={!!busy}
        >
          <Icon name="trash" />
          {busy ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
export function AddToPlaylistDialog({
  track,
  playlists,
  busy,
  onAdd,
  onCreate,
  onClose,
}: {
  track: Track;
  playlists: PlaylistSummary[];
  busy: string;
  onAdd: (playlistId: string) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <Modal
      label={`Add ${track.title} to a playlist`}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="eyebrow">FILE IT WITH THE OTHERS</p>
      <h2>{track.title}</h2>
      <p className="muted">
        {track.artist} · the original stays exactly where it is.
      </p>
      {playlists.length > 0 && (
        <ul className="playlist-picker">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <button
                type="button"
                className="playlist-picker-row"
                disabled={!!busy}
                onClick={() => onAdd(playlist.id)}
              >
                <PlaylistCover title={playlist.title} className="mini-cover" />
                <span>
                  <strong>{playlist.title}</strong>
                  <small>
                    {playlistSummaryText(
                      playlist.track_count,
                      playlist.duration,
                    )}
                  </small>
                </span>
                <Icon name="plus" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="import-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (value && !busy) onCreate(value);
        }}
      >
        <label>
          {playlists.length ? "Or start a new one" : "Start a playlist"}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Sunday morning"
            maxLength={120}
            required
          />
        </label>
        <button
          className="button primary"
          type="submit"
          disabled={!!busy || !title.trim()}
        >
          <Icon name="plus" />
          {busy ? "Saving…" : "Create and add"}
        </button>
      </form>
    </Modal>
  );
}

export function TrackPickerDialog({
  albums,
  existing,
  busy,
  onAdd,
  onClose,
}: {
  albums: Album[];
  existing: readonly string[];
  busy: string;
  onAdd: (track: Track) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(existing);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      albums
        .map((album) => ({
          album,
          tracks: album.tracks.filter((track) =>
            `${track.title} ${track.artist} ${album.title} ${album.artist}`
              .toLowerCase()
              .includes(needle),
          ),
        }))
        .filter((group) => group.tracks.length > 0),
    [albums, needle],
  );
  return (
    <Modal
      label="Add tracks to this playlist"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="eyebrow">FROM ANY ALBUM</p>
      <h2>Add tracks.</h2>
      <label className="search-field playlist-search">
        <Icon name="search" />
        <span className="sr-only">Search your library</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Songs, artists, albums"
        />
      </label>
      <div className="playlist-picker-scroll">
        {groups.map(({ album, tracks }) => (
          <section key={album.id} className="picker-album">
            <h3>
              {album.title} <span>{album.artist}</span>
            </h3>
            <ul>
              {tracks.map((track) => {
                const already = selected.has(track.id);
                return (
                  <li key={track.id}>
                    <span className="picker-track">
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist} · {formatTime(track.duration)}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={
                        already
                          ? `${track.title} is already in this playlist`
                          : `Add ${track.title} to this playlist`
                      }
                      disabled={!!busy || already}
                      onClick={() => onAdd(track)}
                    >
                      <Icon name={already ? "check" : "plus"} size={17} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!groups.length && (
          <p className="muted small">
            {albums.length
              ? "No tracks match that search."
              : "Import an album first, then add its tracks here."}
          </p>
        )}
      </div>
      <button className="button primary" type="button" onClick={onClose}>
        <Icon name="check" />
        Done
      </button>
    </Modal>
  );
}

export function PlaylistDetail({
  playlist,
  albumTitles,
  downloaded,
  outdated,
  authenticated,
  online,
  busy,
  currentTrackId,
  playing,
  onBack,
  onPlay,
  onShuffle,
  onQueue,
  onRename,
  onDelete,
  onAddTracks,
  onRemoveTrack,
  onMoveTrack,
  onDownload,
}: {
  playlist: Playlist;
  albumTitles: Record<string, string>;
  downloaded: boolean;
  outdated: boolean;
  authenticated: boolean;
  online: boolean;
  busy: string;
  currentTrackId: string | null;
  playing: boolean;
  onBack: () => void;
  onPlay: (index: number) => void;
  onShuffle: () => void;
  onQueue: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddTracks: () => void;
  onRemoveTrack: (track: Track) => void;
  onMoveTrack: (track: Track, direction: -1 | 1) => void;
  onDownload: () => void;
}) {
  const canEdit = authenticated && online && !busy;
  return (
    <>
      <button className="button text-button back-button" onClick={onBack}>
        <Icon name="back" />
        Back to playlists
      </button>
      <section className="album-hero playlist-hero">
        <PlaylistCover title={playlist.title} />
        <div className="album-info">
          <p className="eyebrow">
            A PLAYLIST OF YOUR OWN{downloaded ? " · ON THIS DEVICE" : ""}
          </p>
          <h1>{playlist.title}</h1>
          <p className="muted">
            {playlistSummaryText(playlist.track_count, playlist.duration)}
            {downloaded ? " · available offline" : ""}
          </p>
          <div className="album-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => onPlay(0)}
              disabled={!playlist.tracks.length}
            >
              <Icon name="play" />
              Play playlist
            </button>
            <button
              type="button"
              className="button"
              onClick={onShuffle}
              disabled={!playlist.tracks.length}
            >
              <Icon name="shuffle" />
              Shuffle
            </button>
            <button
              type="button"
              className="button"
              onClick={onQueue}
              disabled={!playlist.tracks.length}
            >
              <Icon name="queue" />
              Add to queue
            </button>
            {downloaded && !outdated ? (
              <span className="downloaded-tag">
                <Icon name="check" size={17} />
                On this device
              </span>
            ) : (
              <button
                type="button"
                className="button"
                onClick={onDownload}
                disabled={
                  !authenticated || !online || !!busy || !playlist.tracks.length
                }
              >
                <Icon name="download" />
                {downloaded ? "Update download" : "Download playlist"}
              </button>
            )}
          </div>
          <div className="playlist-edit-actions">
            <button
              type="button"
              className="button text-button"
              onClick={onRename}
              disabled={!canEdit}
            >
              <Icon name="edit" size={15} />
              Rename
            </button>
            <button
              type="button"
              className="button text-button"
              onClick={onDelete}
              disabled={!canEdit}
            >
              <Icon name="trash" size={15} />
              Delete playlist
            </button>
          </div>
        </div>
      </section>

      <div className="section-heading playlist-track-heading">
        <h2>
          In this playlist <span>{playlist.tracks.length}</span>
        </h2>
        <button
          type="button"
          className="button subtle"
          onClick={onAddTracks}
          disabled={!authenticated || !online || !!busy}
        >
          <Icon name="plus" size={16} />
          Add tracks
        </button>
      </div>
      {playlist.tracks.length ? (
        <ol className="track-list playlist-track-list">
          {playlist.tracks.map((track, index) => (
            <li
              key={track.id}
              className={currentTrackId === track.id ? "current-track" : ""}
            >
              <button
                className="track-play"
                onClick={() => onPlay(index)}
                aria-label={`Play ${track.title}`}
              >
                <span className="track-number">
                  {currentTrackId === track.id && playing ? (
                    <span className="equalizer">▂▆▄</span>
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="track-meta">
                  <strong>{track.title}</strong>
                  <span>
                    {track.artist}
                    {albumTitles[track.album_id]
                      ? ` · ${albumTitles[track.album_id]}`
                      : ""}
                  </span>
                </span>
              </button>
              <span className="track-time">{formatTime(track.duration)}</span>
              <div className="track-tools">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${track.title} up`}
                  disabled={!canEdit || index === 0}
                  onClick={() => onMoveTrack(track, -1)}
                >
                  <Icon name="up" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${track.title} down`}
                  disabled={!canEdit || index === playlist.tracks.length - 1}
                  onClick={() => onMoveTrack(track, 1)}
                >
                  <Icon name="down" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${track.title} from playlist`}
                  disabled={!canEdit}
                  onClick={() => onRemoveTrack(track)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty playlist-empty">
          <Icon name="playlist" size={40} />
          <h2>No tracks yet.</h2>
          <p>
            Add anything from your collection. The albums themselves stay
            exactly where they are.
          </p>
          <button
            type="button"
            className="button primary"
            onClick={onAddTracks}
            disabled={!authenticated || !online || !!busy}
          >
            <Icon name="plus" />
            Add tracks
          </button>
        </div>
      )}
      <p className="original-note">
        <Icon name="record" size={16} /> Playlists point at your existing
        originals. Removing a track never deletes music.
      </p>
    </>
  );
}

export function DownloadedPlaylists({
  playlists,
  busy,
  onOpen,
  onPlay,
  onVerify,
  onRemove,
}: {
  playlists: Playlist[];
  busy: string;
  onOpen: (id: string) => void;
  onPlay: (playlist: Playlist) => void;
  onVerify: (playlist: Playlist) => void;
  onRemove: (playlist: Playlist) => void;
}) {
  if (!playlists.length) return null;
  return (
    <section className="downloaded-playlists">
      <div className="section-heading">
        <h2>
          Playlists on this device <span>{playlists.length}</span>
        </h2>
      </div>
      <ul className="download-rows">
        {playlists.map((playlist) => (
          <li key={playlist.id}>
            <button
              type="button"
              className="download-row-main"
              onClick={() => onOpen(playlist.id)}
              aria-label={`Open ${playlist.title}`}
            >
              <PlaylistCover title={playlist.title} className="mini-cover" />
              <span>
                <strong>{playlist.title}</strong>
                <small>
                  {playlistSummaryText(playlist.track_count, playlist.duration)}
                </small>
              </span>
            </button>
            <div className="download-row-tools">
              <button
                type="button"
                className="icon-button"
                aria-label={`Play ${playlist.title}`}
                disabled={!!busy}
                onClick={() => onPlay(playlist)}
              >
                <Icon name="play" size={16} />
              </button>
              <button
                type="button"
                className="button text-button"
                disabled={!!busy}
                onClick={() => onVerify(playlist)}
              >
                Verify
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove download of ${playlist.title}`}
                disabled={!!busy}
                onClick={() => onRemove(playlist)}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
