import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, jsonOptions } from "./api";
import { Icon, type IconName } from "./icons";
import {
  clearDevice,
  downloadAlbum,
  downloadPlaylist,
  downloads,
  playlistDownloads,
  recoverDownloads,
  removeDownload,
  removePlaylistDownload,
  verifyDownload,
  verifyPlaylistDownload,
  type Download,
  type PlaylistDownload,
} from "./offline";
import { importAlbum } from "./importer";
import { usePlayer } from "./player";
import { useDialogFocus } from "./useDialogFocus";
import {
  AddToPlaylistDialog,
  ConfirmDialog,
  DownloadedPlaylists,
  PlaylistCard,
  PlaylistDetail,
  PlaylistTitleDialog,
  TrackPickerDialog,
} from "./playlists";
import {
  MAX_AUDIO_BYTES,
  formatBytes,
  formatTime,
  type Album,
  type Playlist,
  type PlaylistSummary,
  type Track,
} from "../shared/model";
import {
  playlistDuration,
  sameTracks,
  shuffle,
  totalTrackBytes,
  uniqueTracks,
} from "../shared/playlists";

type View = "library" | "playlists" | "downloads" | "search";
function Cover({
  album,
  artwork,
  className = "",
}: {
  album: Album;
  artwork?: string;
  className?: string;
}) {
  return (
    <div className={`cover ${className}`}>
      {artwork || (album.has_artwork && navigator.onLine) ? (
        <img
          src={artwork || `/api/albums/${album.id}/artwork`}
          alt={`${album.title} cover`}
        />
      ) : (
        <div className="cover-fallback">
          <Icon name="record" size={72} />
          <span>{album.title}</span>
        </div>
      )}
    </div>
  );
}
function Button({
  icon,
  children,
  onClick,
  className = "",
  disabled = false,
  label,
}: {
  icon?: IconName;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`button ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}

export function App() {
  const [library, setLibrary] = useState<Album[]>([]);
  const [saved, setSaved] = useState<Download[]>([]);
  const [playlistRecords, setPlaylistRecords] = useState<PlaylistDownload[]>(
    [],
  );
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [openedPlaylist, setOpenedPlaylist] = useState<Playlist | null>(null);
  const [art, setArt] = useState<Record<string, string>>({});
  const [authenticated, setAuthenticated] = useState(false);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [view, setView] = useState<View>("library");
  const [selected, setSelected] = useState<Album | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null);
  const dialogOpen =
    importOpen ||
    loginOpen ||
    playerOpen ||
    createOpen ||
    renameOpen ||
    deleteOpen ||
    pickerOpen ||
    pendingTrack !== null;
  const dialogRef = useDialogFocus(importOpen || loginOpen || playerOpen);
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
    persisted?: boolean;
  }>({});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 9000);
  }, []);
  const playlistTrackPool = useMemo(
    () => playlistRecords.flatMap((record) => record.playlist.tracks),
    [playlistRecords],
  );
  const player = usePlayer(library, playlistTrackPool, authenticated, notify);
  const savedIds = new Set(saved.map((d) => d.album.id));
  const downloadedPlaylistIds = new Set(
    playlistRecords.map((record) => record.playlist.id),
  );

  const refreshDownloads = useCallback(async () => {
    setSaved(await downloads());
    setPlaylistRecords(await playlistDownloads());
    const estimate = await navigator.storage?.estimate();
    setStorage({
      ...estimate,
      persisted: await navigator.storage?.persisted?.(),
    });
  }, []);
  const refreshPlaylists = useCallback(async () => {
    const response = await api<{ playlists: PlaylistSummary[] }>("/playlists");
    setPlaylists(response.playlists);
  }, []);
  const refreshLibrary = useCallback(async () => {
    const response = await api<{ albums: Album[] }>("/library");
    setLibrary(response.albums);
    setAuthenticated(true);
    await refreshPlaylists();
  }, [refreshPlaylists]);
  useEffect(() => {
    let active = true;
    void (async () => {
      await recoverDownloads();
      const local = await downloads();
      if (!active) return;
      setSaved(local);
      setLibrary(local.map((d) => d.album));
      if (navigator.onLine && localStorage.getItem("deepcuts-pending-logout")) {
        const response = await fetch("/api/logout", { method: "POST" }).catch(
          () => null,
        );
        if (response && (response.ok || response.status === 401))
          localStorage.removeItem("deepcuts-pending-logout");
      } else if (navigator.onLine) {
        try {
          await api("/session");
          if (active) await refreshLibrary();
        } catch {
          /* An offline collection remains available when the session expires. */
        }
      }
      if (active) setReady(true);
      await refreshDownloads();
    })().catch(() => {
      notify(
        "Device storage is unavailable. Enable browser storage to use Deep Cuts.",
      );
      setReady(true);
    });
    const connect = () => setOnline(navigator.onLine);
    const message = (event: Event) =>
      notify((event as CustomEvent<string>).detail);
    window.addEventListener("online", connect);
    window.addEventListener("offline", connect);
    window.addEventListener("deepcuts-notice", message);
    return () => {
      active = false;
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", connect);
      window.removeEventListener("deepcuts-notice", message);
    };
  }, [notify, refreshDownloads, refreshLibrary]);
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const item of saved)
      if (item.artwork) urls[item.album.id] = URL.createObjectURL(item.artwork);
    setArt(urls);
    return () => {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    };
  }, [saved]);
  useEffect(() => {
    const handle = () => {
      const hash = location.hash.slice(1);
      if (hash.startsWith("album/")) {
        setPlaylistId(null);
        setSelected(library.find((a) => a.id === hash.slice(6)) ?? null);
        return;
      }
      if (hash.startsWith("playlist/")) {
        setSelected(null);
        setView("playlists");
        setPlaylistId(hash.slice(9));
        return;
      }
      setSelected(null);
      setPlaylistId(null);
      setView(
        ["downloads", "search", "playlists"].includes(hash)
          ? (hash as View)
          : "library",
      );
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [library]);
  useEffect(() => {
    if (!playlistId) {
      setOpenedPlaylist(null);
      return;
    }
    const local =
      playlistRecords.find((record) => record.playlist.id === playlistId)
        ?.playlist ?? null;
    if (!authenticated || !online) {
      setOpenedPlaylist(local);
      return;
    }
    let active = true;
    void api<{ playlist: Playlist }>(`/playlists/${playlistId}`)
      .then((response) => {
        if (active) setOpenedPlaylist(response.playlist);
      })
      .catch(() => {
        // A playlist that only exists on this device still opens offline.
        if (active) setOpenedPlaylist(local);
      });
    return () => {
      active = false;
    };
  }, [playlistId, authenticated, online, playlistRecords]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !player.currentTrack) return;
    const album = player.currentAlbum;
    const artwork =
      album &&
      (art[album.id] ||
        (online && authenticated && album.has_artwork
          ? `${location.origin}/api/albums/${album.id}/artwork`
          : null));
    navigator.mediaSession.metadata = new MediaMetadata({
      title: player.currentTrack.title,
      artist: player.currentTrack.artist,
      album: album?.title,
      artwork: artwork ? [{ src: artwork }] : [],
    });
  }, [player.currentTrack, player.currentAlbum, art, online, authenticated]);

  async function run(task: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(message);
    try {
      await task();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = String(new FormData(form).get("key"));
    await run(async () => {
      await api("/login", jsonOptions("POST", { key }));
      localStorage.removeItem("deepcuts-pending-logout");
      form.reset();
      await refreshLibrary();
      setLoginOpen(false);
    }, "Opening your library…");
  }
  async function signOut() {
    await run(async () => {
      // Clear the local collection before revoking the server session. Neither
      // an expired cookie nor a network outage should prevent local removal.
      localStorage.setItem("deepcuts-pending-logout", "1");
      player.stop();
      await clearDevice();
      if (online) {
        const response = await fetch("/api/logout", { method: "POST" }).catch(
          () => null,
        );
        if (response && (response.ok || response.status === 401))
          localStorage.removeItem("deepcuts-pending-logout");
        else
          notify(
            "Local data removed. The server session will be revoked when you next open Deep Cuts online.",
          );
      }
      setAuthenticated(false);
      setSaved([]);
      setLibrary([]);
      setPlaylists([]);
      setPlaylistRecords([]);
      setPlaylistId(null);
      setOpenedPlaylist(null);
      setSelected(null);
      location.hash = "";
    }, "Removing this device’s downloads…");
  }
  async function saveAlbum(album: Album) {
    await run(async () => {
      await downloadAlbum(album, setBusy);
      await refreshDownloads();
      notify("Album downloaded and verified. Ready when you are.");
    }, "Preparing download…");
  }
  function showPlaylist(id: string) {
    location.hash = `playlist/${id}`;
    setPlaylistId(id);
  }
  async function createPlaylist(title: string) {
    await run(async () => {
      const created = await api<{ playlist: PlaylistSummary }>(
        "/playlists",
        jsonOptions("POST", { title }),
      );
      await refreshPlaylists();
      setCreateOpen(false);
      showPlaylist(created.playlist.id);
      notify(`“${created.playlist.title}” is ready for tracks.`);
    }, "Creating playlist…");
  }
  async function createPlaylistWithTrack(title: string) {
    const track = pendingTrack;
    if (!track) return;
    await run(async () => {
      const created = await api<{ playlist: PlaylistSummary }>(
        "/playlists",
        jsonOptions("POST", { title }),
      );
      await api(
        `/playlists/${created.playlist.id}/tracks`,
        jsonOptions("POST", { track_id: track.id }),
      );
      await refreshPlaylists();
      setPendingTrack(null);
      notify(`Added “${track.title}” to “${created.playlist.title}”.`);
    }, "Adding to playlist…");
  }
  async function addToPlaylist(id: string, track: Track) {
    await run(async () => {
      await api(
        `/playlists/${id}/tracks`,
        jsonOptions("POST", { track_id: track.id }),
      );
      await refreshPlaylists();
      setOpenedPlaylist((current) =>
        current && current.id === id
          ? {
              ...current,
              tracks: [...current.tracks, track],
              track_count: current.tracks.length + 1,
              duration: current.duration + track.duration,
            }
          : current,
      );
      setPendingTrack(null);
      notify(`Added “${track.title}”.`);
    }, "Adding to playlist…");
  }
  async function renamePlaylist(title: string) {
    if (!openedPlaylist) return;
    await run(async () => {
      await api(
        `/playlists/${openedPlaylist.id}`,
        jsonOptions("PATCH", { title }),
      );
      setOpenedPlaylist({ ...openedPlaylist, title });
      await refreshPlaylists();
      setRenameOpen(false);
      notify("Playlist renamed.");
    }, "Saving name…");
  }
  async function deletePlaylist() {
    const playlist = openedPlaylist;
    if (!playlist) return;
    await run(async () => {
      await api(`/playlists/${playlist.id}`, { method: "DELETE" });
      // A deleted playlist should not linger as an offline collection, but its
      // files stay if any album or other playlist still needs them.
      if (downloadedPlaylistIds.has(playlist.id))
        await removePlaylistDownload(playlist);
      await Promise.all([refreshPlaylists(), refreshDownloads()]);
      setDeleteOpen(false);
      setOpenedPlaylist(null);
      setPlaylistId(null);
      location.hash = "playlists";
      notify("Playlist deleted. Your music is untouched.");
    }, "Deleting playlist…");
  }
  async function removeTrackFromPlaylist(track: Track) {
    const playlist = openedPlaylist;
    if (!playlist) return;
    await run(async () => {
      await api(`/playlists/${playlist.id}/tracks/${track.id}`, {
        method: "DELETE",
      });
      const tracks = playlist.tracks.filter((item) => item.id !== track.id);
      setOpenedPlaylist({
        ...playlist,
        tracks,
        track_count: tracks.length,
        duration: playlistDuration(tracks),
      });
      await refreshPlaylists();
      notify(`Removed “${track.title}”. Your music is untouched.`);
    }, "Updating playlist…");
  }
  async function movePlaylistTrack(track: Track, direction: -1 | 1) {
    const playlist = openedPlaylist;
    if (!playlist) return;
    const index = playlist.tracks.findIndex((item) => item.id === track.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= playlist.tracks.length) return;
    const tracks = playlist.tracks.slice();
    [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    setOpenedPlaylist({ ...playlist, tracks });
    await run(async () => {
      try {
        await api(
          `/playlists/${playlist.id}/tracks`,
          jsonOptions("PUT", { track_ids: tracks.map((item) => item.id) }),
        );
      } catch (error) {
        setOpenedPlaylist(playlist);
        throw error;
      }
    }, "Saving order…");
  }
  async function savePlaylist(playlist: Playlist) {
    await run(async () => {
      await downloadPlaylist(playlist, setBusy);
      await refreshDownloads();
      notify("Playlist downloaded and verified. Ready when you are.");
    }, "Preparing playlist download…");
  }
  async function checkPlaylistDownload(playlist: Playlist) {
    await run(async () => {
      await verifyPlaylistDownload(playlist);
      notify("Every playlist track verified. Your originals are intact.");
    }, "Checking downloaded playlist…");
  }
  async function removePlaylistFromDevice(playlist: Playlist) {
    await run(async () => {
      await removePlaylistDownload(playlist);
      await refreshDownloads();
      if (!authenticated) {
        setOpenedPlaylist(null);
        setPlaylistId(null);
        location.hash = "playlists";
      }
      notify("Playlist download removed from this device.");
    }, "Removing playlist download…");
  }
  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = Array.from(
      (form.elements.namedItem("files") as HTMLInputElement).files ?? [],
    );
    await run(async () => {
      await importAlbum(
        files,
        String(data.get("title") ?? ""),
        String(data.get("artist") ?? ""),
        setBusy,
      );
      await refreshLibrary();
      setImportOpen(false);
      notify("Your album is in the library.");
    }, "Reading your album…");
  }
  const navigate = (next: View) => {
    location.hash = next;
    setSelected(null);
    setPlaylistId(null);
    setOpenedPlaylist(null);
    setView(next);
  };
  const showAlbum = (album: Album) => {
    location.hash = `album/${album.id}`;
    setSelected(album);
  };
  const visible = (
    view === "downloads" ? saved.map((d) => d.album) : library
  ).filter(
    (a) =>
      view !== "search" ||
      `${a.title} ${a.artist} ${a.tracks.map((t) => t.title).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visiblePlaylists = useMemo<PlaylistSummary[]>(
    () =>
      authenticated && online
        ? playlists
        : playlistRecords.map(({ playlist }) => ({
            ...playlist,
            track_count: playlist.tracks.length,
            duration: playlistDuration(playlist.tracks),
          })),
    [authenticated, online, playlists, playlistRecords],
  );
  const albumTitles = useMemo(
    () => Object.fromEntries(library.map((album) => [album.id, album.title])),
    [library],
  );
  const localTracks = useMemo(
    () =>
      uniqueTracks(
        ...saved.map((download) => download.album.tracks),
        ...playlistRecords.map((record) => record.playlist.tracks),
      ),
    [saved, playlistRecords],
  );
  const signedOut =
    ready && !authenticated && !saved.length && !playlistRecords.length;
  const totalBytes =
    totalTrackBytes(localTracks) +
    saved.reduce((sum, download) => sum + (download.artwork?.size ?? 0), 0);
  const loginForm = (
    <form onSubmit={signIn} className="login-form">
      <label htmlFor="owner-key">Your access key</label>
      <input
        id="owner-key"
        name="key"
        type="password"
        autoComplete="current-password"
        required
        maxLength={256}
        placeholder="Paste your private access key"
        autoCapitalize="none"
        spellCheck={false}
      />
      <button
        className="button primary"
        disabled={!!busy || !online}
        type="submit"
      >
        <Icon name="record" />
        {busy || "Open my library"}
      </button>
      <p className="muted small">
        A private space for music you own. Your access key stays on the server;
        this device receives a secure session.
      </p>
    </form>
  );

  return (
    <>
      <audio
        ref={player.audio}
        {...player.events}
        preload="metadata"
        data-testid="audio"
      />
      {signedOut ? (
        <main className="welcome">
          <div className="welcome-art" aria-hidden="true">
            <div className="vinyl">
              <div className="vinyl-label">
                deep
                <br />
                <em>cuts</em>
                <span>PLAY IT AGAIN.</span>
              </div>
            </div>
            <span className="edition">A COLLECTION OF YOUR OWN</span>
          </div>
          <section className="welcome-copy">
            <div className="brand">
              <Icon name="record" size={30} /> deep cuts
            </div>
            <p className="eyebrow">GOOD MUSIC DESERVES A GOOD HOME</p>
            <h1>
              Your music.
              <br />
              <em>A little closer.</em>
            </h1>
            <p className="intro">
              The albums you keep coming back to.
              <br />
              The tracks that never get old. All yours.
            </p>
            {online ? (
              loginForm
            ) : (
              <div className="empty">
                <Icon name="download" />
                <h2>No downloads on this device yet.</h2>
                <p>Connect and sign in to download an album or playlist.</p>
              </div>
            )}
            <span className="welcome-foot">
              NO ALGORITHM. JUST YOUR RECORDS.
            </span>
          </section>
        </main>
      ) : (
        <div
          className={`app ${player.currentTrack ? "has-player" : ""}`}
          inert={dialogOpen}
        >
          <aside className="sidebar">
            <a className="brand" href="#library">
              <Icon name="record" size={30} /> deep cuts
            </a>
            <p className="eyebrow nav-caption">YOUR LISTENING ROOM</p>
            <nav aria-label="Main navigation">
              {(
                [
                  ["library", "library", "Library"],
                  ["playlists", "playlist", "Playlists"],
                  ["search", "search", "Search"],
                  ["downloads", "download", "Downloads"],
                ] as const
              ).map(([key, icon, label]) => (
                <a
                  key={key}
                  className={
                    view === key && !selected && !playlistId ? "active" : ""
                  }
                  href={`#${key}`}
                  aria-current={
                    view === key && !selected && !playlistId
                      ? "page"
                      : undefined
                  }
                  onClick={() => navigate(key)}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                  {key === "downloads" && <small>{saved.length}</small>}
                  {key === "playlists" && visiblePlaylists.length > 0 && (
                    <small>{visiblePlaylists.length}</small>
                  )}
                </a>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="private-label">
                <span className="status-dot" />A collection of your own
              </div>
              <p>Owned. Loved. On repeat.</p>
              <Button
                icon="logout"
                onClick={() => {
                  void signOut();
                }}
                disabled={!!busy}
              >
                Sign out & clear device
              </Button>
            </div>
          </aside>
          <main className="main-content">
            <header className="topbar">
              <a href="#library" className="mobile-brand brand">
                <Icon name="record" />
                deep cuts
              </a>
              <span className="desktop-only breadcrumb">
                YOUR MUSIC, A LITTLE CLOSER.
              </span>
              <div className="top-actions">
                <span className="connection">
                  <span className={`status-dot ${online ? "" : "offline"}`} />
                  {online ? "Private library" : "Offline"}
                </span>
                {authenticated ? (
                  <Button
                    icon="plus"
                    className="subtle import-trigger"
                    onClick={() => setImportOpen(true)}
                    disabled={!online || !!busy}
                  >
                    Import album
                  </Button>
                ) : (
                  <Button
                    className="subtle"
                    onClick={() => setLoginOpen(true)}
                    disabled={!online}
                  >
                    Sign in
                  </Button>
                )}
              </div>
            </header>
            {!ready ? (
              <div className="empty" role="status">
                <Icon name="record" size={48} />
                <p>Opening your listening room…</p>
              </div>
            ) : (
              <>
                {!online && (
                  <div className="offline-banner">
                    <Icon name="download" size={16} /> You’re offline. Your
                    downloaded records are right here.
                  </div>
                )}
                {playlistId ? (
                  openedPlaylist ? (
                    <PlaylistDetail
                      playlist={openedPlaylist}
                      albumTitles={albumTitles}
                      downloaded={downloadedPlaylistIds.has(openedPlaylist.id)}
                      outdated={
                        downloadedPlaylistIds.has(openedPlaylist.id) &&
                        !sameTracks(
                          playlistRecords.find(
                            (record) =>
                              record.playlist.id === openedPlaylist.id,
                          )?.playlist.tracks ?? [],
                          openedPlaylist.tracks,
                        )
                      }
                      authenticated={authenticated}
                      online={online}
                      busy={busy}
                      currentTrackId={player.current}
                      playing={player.playing}
                      onBack={() => navigate("playlists")}
                      onPlay={(index) =>
                        player.playTracks(openedPlaylist.tracks, index)
                      }
                      onShuffle={() =>
                        player.playTracks(shuffle(openedPlaylist.tracks))
                      }
                      onQueue={() =>
                        player.enqueueTracks(openedPlaylist.tracks)
                      }
                      onRename={() => setRenameOpen(true)}
                      onDelete={() => setDeleteOpen(true)}
                      onAddTracks={() => setPickerOpen(true)}
                      onRemoveTrack={(track) => {
                        void removeTrackFromPlaylist(track);
                      }}
                      onMoveTrack={(track, direction) => {
                        void movePlaylistTrack(track, direction);
                      }}
                      onDownload={() => {
                        void savePlaylist(openedPlaylist);
                      }}
                    />
                  ) : (
                    <div className="empty" role="status">
                      <Icon name="playlist" size={48} />
                      <h2>That playlist is not on this device.</h2>
                      <p>
                        Reconnect and sign in to open it, or download it next
                        time you have a connection.
                      </p>
                      <Button onClick={() => navigate("playlists")}>
                        Back to playlists
                      </Button>
                    </div>
                  )
                ) : selected ? (
                  <>
                    <Button
                      className="text-button back-button"
                      icon="back"
                      onClick={() => navigate(view)}
                    >
                      Back to {view === "downloads" ? "downloads" : "library"}
                    </Button>
                    <section className="album-hero">
                      <Cover album={selected} artwork={art[selected.id]} />
                      <div className="album-info">
                        <p className="eyebrow">
                          IN YOUR COLLECTION{" "}
                          {savedIds.has(selected.id) && "· DOWNLOADED"}
                        </p>
                        <h1>{selected.title}</h1>
                        <p className="album-artist">{selected.artist}</p>
                        <p className="muted">
                          {selected.year ? `${selected.year} · ` : ""}
                          {selected.tracks.length} tracks ·{" "}
                          {Math.ceil(
                            selected.tracks.reduce(
                              (s, t) => s + t.duration,
                              0,
                            ) / 60,
                          )}{" "}
                          min
                        </p>
                        <div className="album-actions">
                          <Button
                            icon="play"
                            className="primary"
                            onClick={() => player.playTracks(selected.tracks)}
                          >
                            Play album
                          </Button>
                          {!savedIds.has(selected.id) ? (
                            <Button
                              icon="download"
                              onClick={() => {
                                void saveAlbum(selected);
                              }}
                              disabled={!online || !authenticated || !!busy}
                            >
                              Download
                            </Button>
                          ) : (
                            <span className="downloaded-tag">
                              <Icon name="check" size={17} />
                              On this device
                            </span>
                          )}
                        </div>
                      </div>
                    </section>
                    <div className="track-heading">
                      <span>TRACK</span>
                      <span>
                        <Icon name="volume" size={15} />
                      </span>
                    </div>
                    <ol className="track-list">
                      {selected.tracks.map((track, i) => (
                        <li
                          key={track.id}
                          className={
                            player.current === track.id ? "current-track" : ""
                          }
                        >
                          <button
                            className="track-play"
                            onClick={() =>
                              player.playTracks(selected.tracks, i)
                            }
                            aria-label={`Play ${track.title}`}
                          >
                            <span className="track-number">
                              {player.current === track.id && player.playing ? (
                                <span className="equalizer">▂▆▄</span>
                              ) : (
                                String(i + 1).padStart(2, "0")
                              )}
                            </span>
                            <span className="track-meta">
                              <strong>{track.title}</strong>
                              <span>{track.artist}</span>
                            </span>
                          </button>
                          <span className="format-label">
                            {track.mime === "audio/flac"
                              ? "FLAC"
                              : track.mime === "audio/mpeg"
                                ? "MP3"
                                : "AAC"}
                          </span>
                          <span className="track-time">
                            {formatTime(track.duration)}
                          </span>
                          <Button
                            icon="playlist"
                            className="icon-button"
                            label={`Add ${track.title} to a playlist`}
                            disabled={!authenticated || !online || !!busy}
                            onClick={() => setPendingTrack(track)}
                          />
                          <Button
                            icon="plus"
                            className="icon-button"
                            label={`Add ${track.title} to queue`}
                            onClick={() => player.enqueue(track)}
                          />
                        </li>
                      ))}
                    </ol>
                    <p className="original-note">
                      <Icon name="record" size={16} /> Your originals, exactly
                      as you imported them.
                    </p>
                  </>
                ) : (
                  <>
                    <section className="page-heading">
                      <div>
                        <p className="eyebrow">
                          {view === "downloads"
                            ? "TAKE THE GOOD STUFF WITH YOU"
                            : view === "search"
                              ? "FIND YOUR NEXT REPEAT"
                              : view === "playlists"
                                ? "YOUR OWN RUNNING ORDER"
                                : "OWNED. LOVED. ON REPEAT."}
                        </p>
                        <h1>
                          {view === "downloads"
                            ? "Made for offline."
                            : view === "search"
                              ? "Something in mind?"
                              : view === "playlists"
                                ? "Playlists."
                                : "Your collection."}
                        </h1>
                        <p>
                          {view === "downloads"
                            ? "No signal required. Just press play."
                            : view === "search"
                              ? "An album, an artist, that one song."
                              : view === "playlists"
                                ? "Any track, any album, in exactly your order."
                                : "A home for the records that feel like you."}
                        </p>
                      </div>
                      <div className="heading-record" aria-hidden="true">
                        <Icon
                          name={view === "playlists" ? "playlist" : "record"}
                          size={82}
                        />
                      </div>
                    </section>
                    {view === "search" && (
                      <label className="search-field">
                        <Icon name="search" />
                        <span className="sr-only">Search your library</span>
                        <input
                          autoFocus
                          type="search"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Albums, artists, and songs"
                        />
                      </label>
                    )}
                    {view === "downloads" && (
                      <section className="storage-card">
                        <Icon name="download" size={28} />
                        <div>
                          <strong>
                            {formatBytes(totalBytes)} of music on this device
                          </strong>
                          <p>
                            {saved.length}{" "}
                            {saved.length === 1 ? "album" : "albums"} ·{" "}
                            {playlistRecords.length}{" "}
                            {playlistRecords.length === 1
                              ? "playlist"
                              : "playlists"}{" "}
                            ·{" "}
                            {storage.persisted
                              ? "Persistent storage granted"
                              : "Browser storage · may be cleared by your browser"}
                          </p>
                          {storage.quota && (
                            <p>
                              {formatBytes(
                                Math.max(
                                  0,
                                  storage.quota - (storage.usage ?? 0),
                                ),
                              )}{" "}
                              available to this site
                            </p>
                          )}
                        </div>
                      </section>
                    )}
                    {view === "downloads" && (
                      <DownloadedPlaylists
                        playlists={playlistRecords.map(
                          (record) => record.playlist,
                        )}
                        busy={busy}
                        onOpen={showPlaylist}
                        onPlay={(playlist) =>
                          player.playTracks(playlist.tracks)
                        }
                        onVerify={(playlist) => {
                          void checkPlaylistDownload(playlist);
                        }}
                        onRemove={(playlist) => {
                          void removePlaylistFromDevice(playlist);
                        }}
                      />
                    )}
                    <div className="section-heading">
                      <h2>
                        {view === "downloads"
                          ? "Ready to go"
                          : view === "search"
                            ? "In your collection"
                            : view === "playlists"
                              ? "Your playlists"
                              : "On your shelf"}{" "}
                        <span>
                          {view === "playlists"
                            ? visiblePlaylists.length
                            : visible.length}
                        </span>
                      </h2>
                      {view === "library" && (
                        <span className="shelf-caption">
                          ALBUMS, FIRST. ALWAYS.
                        </span>
                      )}
                      {view === "playlists" && (
                        <button
                          type="button"
                          className="button subtle"
                          onClick={() => setCreateOpen(true)}
                          disabled={!authenticated || !online || !!busy}
                        >
                          <Icon name="plus" size={16} />
                          New playlist
                        </button>
                      )}
                    </div>
                    {view === "playlists" ? (
                      visiblePlaylists.length ? (
                        <div className="album-grid">
                          {visiblePlaylists.map((playlist) => (
                            <PlaylistCard
                              key={playlist.id}
                              playlist={playlist}
                              downloaded={downloadedPlaylistIds.has(
                                playlist.id,
                              )}
                              onOpen={showPlaylist}
                            />
                          ))}
                        </div>
                      ) : (
                        <section className="empty-shelf">
                          <div className="empty-record" aria-hidden="true">
                            <Icon name="playlist" size={54} />
                          </div>
                          <p className="eyebrow">MIX IT YOUR WAY</p>
                          <h2>Your first playlist starts here.</h2>
                          <p>
                            {authenticated
                              ? "Pull tracks from any album into one running order. Your originals are never copied or moved."
                              : "Playlists you download appear here. Reconnect and sign in to build a new one."}
                          </p>
                          <Button
                            icon="plus"
                            className="primary"
                            onClick={() => setCreateOpen(true)}
                            disabled={!online || !authenticated || !!busy}
                          >
                            Create a playlist
                          </Button>
                        </section>
                      )
                    ) : visible.length ? (
                      <div className="album-grid">
                        {visible.map((album) => (
                          <article className="album-card" key={album.id}>
                            <button
                              className="album-card-link"
                              onClick={() => showAlbum(album)}
                              aria-label={`Open ${album.title}`}
                            >
                              <div className="cover-wrap">
                                <Cover album={album} artwork={art[album.id]} />
                                {savedIds.has(album.id) && (
                                  <span
                                    className="cover-download"
                                    aria-label="Downloaded"
                                  >
                                    <Icon name="download" size={15} />
                                  </span>
                                )}
                                <span className="cover-play">
                                  <Icon name="play" />
                                </span>
                              </div>
                              <h3>{album.title}</h3>
                              <p>{album.artist}</p>
                            </button>
                            {view === "downloads" && (
                              <div className="download-controls">
                                <Button
                                  className="text-button"
                                  icon="check"
                                  disabled={!!busy}
                                  onClick={() => {
                                    void run(async () => {
                                      await verifyDownload(album);
                                      notify(
                                        "Every track verified. Your originals are intact.",
                                      );
                                    }, "Checking downloaded originals…");
                                  }}
                                >
                                  Verify
                                </Button>
                                <Button
                                  className="icon-button"
                                  icon="trash"
                                  label={`Remove download of ${album.title}`}
                                  disabled={!!busy}
                                  onClick={() => {
                                    void run(async () => {
                                      if (player.currentAlbum?.id === album.id)
                                        player.stop();
                                      await removeDownload(album);
                                      await refreshDownloads();
                                      if (!authenticated)
                                        setLibrary((current) =>
                                          current.filter(
                                            (a) => a.id !== album.id,
                                          ),
                                        );
                                      notify(
                                        "Download removed from this device.",
                                      );
                                    }, "Removing download…");
                                  }}
                                />
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <section className="empty-shelf">
                        <div className="empty-record" aria-hidden="true">
                          <Icon
                            name={view === "downloads" ? "download" : "record"}
                            size={54}
                          />
                        </div>
                        <p className="eyebrow">
                          {view === "search"
                            ? "KEEP DIGGING"
                            : "ROOM FOR YOUR FAVORITES"}
                        </p>
                        <h2>
                          {view === "downloads"
                            ? "Good music travels."
                            : view === "search"
                              ? "No records found."
                              : "Every collection starts with one."}
                        </h2>
                        <p>
                          {view === "downloads"
                            ? "Open an album and tap Download. We’ll save and verify every original for offline listening."
                            : view === "search"
                              ? "Try another album, artist, or song title."
                              : "Bring over an album you own. We’ll keep the artwork, the details, and every bit of the original audio."}
                        </p>
                        {view === "library" && (
                          <Button
                            icon="plus"
                            className="primary"
                            onClick={() => setImportOpen(true)}
                            disabled={!online || !authenticated}
                          >
                            Import your first album
                          </Button>
                        )}
                        {view === "downloads" && (
                          <Button
                            className="subtle"
                            onClick={() => navigate("library")}
                          >
                            Explore your library
                          </Button>
                        )}
                      </section>
                    )}
                    <footer className="collection-footer">
                      <Icon name="record" size={17} />
                      <span>KEEP WHAT MOVES YOU.</span>
                      <span>DEEP CUTS · YOUR PERSONAL LISTENING ROOM</span>
                    </footer>
                  </>
                )}
              </>
            )}
          </main>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {(
              [
                ["library", "library", "Library"],
                ["playlists", "playlist", "Playlists"],
                ["search", "search", "Search"],
                ["downloads", "download", "Downloads"],
              ] as const
            ).map(([key, icon, label]) => (
              <a
                key={key}
                href={`#${key}`}
                className={
                  view === key && !selected && !playlistId ? "active" : ""
                }
                onClick={() => navigate(key)}
              >
                <Icon name={icon} />
                <span>{label}</span>
              </a>
            ))}
            <button
              onClick={() => {
                void signOut();
              }}
              disabled={!!busy}
            >
              <Icon name="logout" />
              <span>Sign out</span>
            </button>
          </nav>
          {player.currentTrack && (
            <section className="player-bar" aria-label="Music player">
              <button
                className="now-playing"
                onClick={() => setPlayerOpen(true)}
                aria-label="Open now playing and queue"
              >
                {player.currentAlbum && (
                  <Cover
                    album={player.currentAlbum}
                    artwork={art[player.currentAlbum.id]}
                  />
                )}
                <span>
                  <strong>{player.currentTrack.title}</strong>
                  <small>{player.currentTrack.artist}</small>
                </span>
              </button>
              <div className="transport">
                <Button
                  icon="previous"
                  className="icon-button desktop-only"
                  label="Previous track"
                  onClick={() => player.jump(-1)}
                />
                <Button
                  icon={player.playing ? "pause" : "play"}
                  className="play-button icon-button"
                  label={player.playing ? "Pause" : "Play"}
                  onClick={player.toggle}
                />
                <Button
                  icon="next"
                  className="icon-button"
                  label="Next track"
                  onClick={() => player.jump(1)}
                />
              </div>
              <div className="progress desktop-only">
                <span>{formatTime(player.position)}</span>
                <input
                  aria-label="Seek"
                  type="range"
                  min="0"
                  max={player.duration || 1}
                  step="0.1"
                  value={Math.min(player.position, player.duration || 1)}
                  onChange={(e) => player.seek(Number(e.target.value))}
                />
                <span>{formatTime(player.duration)}</span>
              </div>
              <Button
                icon="queue"
                className="icon-button desktop-only"
                label="Open queue"
                onClick={() => setPlayerOpen(true)}
              />
            </section>
          )}
        </div>
      )}
      {(importOpen || loginOpen || playerOpen) && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setImportOpen(false);
              setLoginOpen(false);
              setPlayerOpen(false);
            }
          }}
        >
          <section
            ref={dialogRef}
            className={`modal ${playerOpen ? "player-modal" : ""} ${importOpen ? "import-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              playerOpen
                ? "Now playing and queue"
                : importOpen
                  ? "Import album"
                  : "Sign in"
            }
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                setImportOpen(false);
                setLoginOpen(false);
                setPlayerOpen(false);
              }
            }}
          >
            <Button
              icon="close"
              label="Close dialog"
              className="icon-button modal-close"
              disabled={!!busy}
              onClick={() => {
                setImportOpen(false);
                setLoginOpen(false);
                setPlayerOpen(false);
              }}
            />
            {importOpen && (
              <>
                <p className="eyebrow">MAKE YOURSELF AT HOME</p>
                <h2>Bring a record over.</h2>
                <p className="muted">
                  One album at a time. Original files, artwork, and all.
                </p>
                <form onSubmit={submitImport} className="import-form">
                  <label>
                    Album title{" "}
                    <span className="muted">optional, read from tags</span>
                    <input
                      name="title"
                      placeholder="Album title"
                      maxLength={300}
                    />
                  </label>
                  <label>
                    Album artist{" "}
                    <span className="muted">optional, read from tags</span>
                    <input
                      name="artist"
                      placeholder="Album artist"
                      maxLength={300}
                    />
                  </label>
                  <label className="file-picker">
                    <Icon name="plus" size={32} />
                    <strong>Choose album files</strong>
                    <span>MP3 · AAC / M4A · FLAC</span>
                    <input
                      name="files"
                      type="file"
                      accept=".mp3,.m4a,.aac,.flac,.jpg,.jpeg,.png"
                      multiple
                      required
                    />
                  </label>
                  <p className="small muted">
                    Select all tracks from one album. Embedded artwork or
                    cover.jpg / folder.png is included. Up to 100 tracks,
                    { " " }{formatBytes(MAX_AUDIO_BYTES)} each. Folder import is
                    available below on supported browsers.
                  </p>
                  <label className="folder-picker">
                    Choose an album folder
                    <input
                      type="file"
                      {...{ webkitdirectory: "", directory: "" }}
                      multiple
                      onChange={(e) => {
                        const target = e.currentTarget.form?.elements.namedItem(
                          "files",
                        ) as HTMLInputElement | null;
                        if (target && e.target.files)
                          target.files = e.target.files;
                      }}
                    />
                  </label>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={!!busy || !authenticated || !online}
                  >
                    <Icon name="plus" />
                    {busy || "Add to my collection"}
                  </button>
                </form>
              </>
            )}
            {loginOpen && (
              <>
                <p className="eyebrow">WELCOME BACK</p>
                <h2>Your listening room awaits.</h2>
                {loginForm}
              </>
            )}
            {playerOpen && player.currentTrack && (
              <>
                <p className="eyebrow">ON THE TURNTABLE</p>
                {player.currentAlbum && (
                  <Cover
                    className="now-playing-cover"
                    album={player.currentAlbum}
                    artwork={art[player.currentAlbum.id]}
                  />
                )}
                <h2>{player.currentTrack.title}</h2>
                <p className="muted">{player.currentTrack.artist}</p>
                <div className="expanded-progress">
                  <input
                    aria-label="Seek in track"
                    type="range"
                    min="0"
                    max={player.duration || 1}
                    step="0.1"
                    value={Math.min(player.position, player.duration || 1)}
                    onChange={(e) => player.seek(Number(e.target.value))}
                  />
                  <div>
                    <span>{formatTime(player.position)}</span>
                    <span>{formatTime(player.duration)}</span>
                  </div>
                </div>
                <div className="expanded-transport">
                  <Button
                    icon="previous"
                    className="icon-button"
                    label="Previous queued track"
                    onClick={() => player.jump(-1)}
                  />
                  <Button
                    icon={player.playing ? "pause" : "play"}
                    className="primary icon-button"
                    label={player.playing ? "Pause playback" : "Start playback"}
                    onClick={player.toggle}
                  />
                  <Button
                    icon="next"
                    className="icon-button"
                    label="Next queued track"
                    onClick={() => player.jump(1)}
                  />
                </div>
                <h3 className="queue-heading">
                  Your queue <span>{player.queue.length} tracks</span>
                </h3>
                <ol className="queue-list">
                  {player.queue.map((id, i) => (
                    <li
                      key={`${id}-${i}`}
                      className={i === player.queueIndex ? "current-track" : ""}
                    >
                      <button onClick={() => player.selectQueue(i)}>
                        {player.tracks.get(id)?.title ?? "Unavailable track"}
                      </button>
                      {i !== player.queueIndex && (
                        <Button
                          icon="close"
                          label={`Remove queued track ${i + 1}`}
                          className="icon-button"
                          onClick={() => player.removeQueue(i)}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
      {createOpen && (
        <PlaylistTitleDialog
          mode="create"
          busy={busy}
          onSubmit={(title) => {
            void createPlaylist(title);
          }}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {renameOpen && openedPlaylist && (
        <PlaylistTitleDialog
          mode="rename"
          initial={openedPlaylist.title}
          busy={busy}
          onSubmit={(title) => {
            void renamePlaylist(title);
          }}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {deleteOpen && openedPlaylist && (
        <ConfirmDialog
          title={`Delete “${openedPlaylist.title}”?`}
          body="The playlist is removed from your account and this device. The tracks, albums and original audio files stay exactly where they are."
          confirmLabel="Delete playlist"
          busy={busy}
          onConfirm={() => {
            void deletePlaylist();
          }}
          onClose={() => setDeleteOpen(false)}
        />
      )}
      {pickerOpen && openedPlaylist && (
        <TrackPickerDialog
          albums={library}
          existing={openedPlaylist.tracks.map((track) => track.id)}
          busy={busy}
          onAdd={(track) => {
            void addToPlaylist(openedPlaylist.id, track);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {pendingTrack && (
        <AddToPlaylistDialog
          track={pendingTrack}
          playlists={visiblePlaylists}
          busy={busy}
          onAdd={(id) => {
            void addToPlaylist(id, pendingTrack);
          }}
          onCreate={(title) => {
            void createPlaylistWithTrack(title);
          }}
          onClose={() => setPendingTrack(null)}
        />
      )}
      {busy && (
        <div className="busy-banner" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
    </>
  );
}
