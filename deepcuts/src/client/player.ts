import { useEffect, useMemo, useRef, useState } from "react";
import type { Album, ListeningState, Track } from "../shared/model";
import { localState, offlineAudio, saveLocalState } from "./offline";
import { api, jsonOptions } from "./api";

export function usePlayer(
  albums: Album[],
  authenticated: boolean,
  notify: (text: string) => void,
) {
  const audio = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const tracks = useMemo(
    () =>
      new Map(albums.flatMap((a) => a.tracks.map((t) => [t.id, t] as const))),
    [albums],
  );
  const currentTrack = current ? tracks.get(current) : undefined;
  const currentAlbum = albums.find((a) => a.id === currentTrack?.album_id);
  const requestPlay = useRef(false);
  const restorePosition = useRef(0);
  const restored = useRef(false);
  const snapshot = useRef<ListeningState>({
    queue,
    current,
    position,
    queue_index: queueIndex,
  });
  snapshot.current = { queue, current, position, queue_index: queueIndex };
  const lastSave = useRef(0);
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    if (!albums.length || restored.current) return;
    restored.current = true;
    void localState()
      .then((state) => {
        if (!state) return;
        const available = state.queue.filter((id) => tracks.has(id));
        setQueue(available);
        setQueueIndex(
          state.queue_index !== undefined &&
            available[state.queue_index] === state.current
            ? state.queue_index
            : Math.max(0, available.indexOf(state.current ?? "")),
        );
        if (state.current && tracks.has(state.current)) {
          restorePosition.current = state.position;
          setCurrent(state.current);
          setPosition(state.position);
        }
      })
      .catch(() =>
        notifyRef.current(
          "Listening state could not be restored on this device.",
        ),
      );
  }, [albums, tracks]);

  const persist = async (force = false) => {
    if (!force && Date.now() - lastSave.current < 5000) return;
    lastSave.current = Date.now();
    const state: ListeningState = {
      ...snapshot.current,
      position: audio.current?.currentTime ?? snapshot.current.position,
    };
    await saveLocalState(state).catch(() => {});
    if (authenticatedRef.current && navigator.onLine)
      void api("/state", jsonOptions("PUT", state)).catch(() => {});
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    const save = () => {
      void persistRef.current(true);
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
    };
  }, []);

  useEffect(() => {
    const element = audio.current;
    if (!element || !currentTrack) return;
    let canceled = false;
    let blobUrl: string | undefined;
    void (async () => {
      const blob = await offlineAudio(currentTrack);
      if (canceled) return;
      if (blob) {
        blobUrl = URL.createObjectURL(blob);
        element.src = blobUrl;
      } else {
        if (!navigator.onLine || !authenticatedRef.current)
          throw new Error("Download this album while online to listen here.");
        element.src = `/api/tracks/${currentTrack.id}/audio`;
      }
      element.load();
      if (requestPlay.current) {
        requestPlay.current = false;
        await element.play();
      }
    })().catch((error) => {
      if (!canceled)
        notifyRef.current(
          error instanceof Error ? error.message : "Playback could not start.",
        );
    });
    return () => {
      canceled = true;
      element.pause();
      element.removeAttribute("src");
      element.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [currentTrack?.id]);

  function playTracks(selected: Track[], index = 0) {
    if (!selected[index]) return;
    restorePosition.current = 0;
    setPosition(0);
    setQueue(selected.map((t) => t.id));
    setQueueIndex(index);
    if (current === selected[index].id && audio.current?.src) {
      audio.current.currentTime = 0;
      void audio.current
        .play()
        .catch(() => notifyRef.current("Tap play again to begin."));
    } else {
      requestPlay.current = true;
      setCurrent(selected[index].id);
    }
  }
  function jump(direction: number) {
    const next = queueIndex + direction;
    if (next >= 0 && next < queue.length) {
      selectQueue(next);
    }
  }
  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused)
      void element
        .play()
        .catch(() =>
          notifyRef.current(
            "Playback could not start. Check the file format and your connection.",
          ),
        );
    else element.pause();
  }
  function seek(value: number) {
    if (audio.current && Number.isFinite(value)) {
      audio.current.currentTime = value;
      setPosition(value);
    }
  }
  function stop() {
    audio.current?.pause();
    audio.current?.removeAttribute("src");
    audio.current?.load();
    requestPlay.current = false;
    setCurrent(null);
    setQueue([]);
    setQueueIndex(0);
    setPosition(0);
    setPlaying(false);
    snapshot.current = {
      current: null,
      queue: [],
      position: 0,
      queue_index: 0,
    };
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }
  function selectQueue(index: number) {
    if (!queue[index]) return;
    restorePosition.current = 0;
    setPosition(0);
    setQueueIndex(index);
    if (queue[index] === current && audio.current?.src) {
      audio.current.currentTime = 0;
      void audio.current
        .play()
        .catch(() => notifyRef.current("Tap play again to begin."));
    } else {
      requestPlay.current = true;
      setCurrent(queue[index]);
    }
  }
  const handlers = useRef({ jump, toggle, seek });
  handlers.current = { jump, toggle, seek };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const actions: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => {
        void audio.current?.play().catch(() => {});
      },
      pause: () => audio.current?.pause(),
      nexttrack: () => handlers.current.jump(1),
      previoustrack: () => handlers.current.jump(-1),
      seekto: (detail) => handlers.current.seek(detail.seekTime ?? 0),
      seekforward: (detail) =>
        handlers.current.seek(
          Math.min(
            audio.current?.duration ?? 0,
            (audio.current?.currentTime ?? 0) + (detail.seekOffset ?? 10),
          ),
        ),
      seekbackward: (detail) =>
        handlers.current.seek(
          Math.max(
            0,
            (audio.current?.currentTime ?? 0) - (detail.seekOffset ?? 10),
          ),
        ),
    };
    for (const [action, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(
          action as MediaSessionAction,
          handler,
        );
      } catch {
        /* Browser does not implement this action. */
      }
    }
    return () => {
      for (const action of Object.keys(actions))
        try {
          navigator.mediaSession.setActionHandler(
            action as MediaSessionAction,
            null,
          );
        } catch {}
    };
  }, []);
  useEffect(() => {
    if ("mediaSession" in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentAlbum?.title,
      });
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      if (duration > 0 && position <= duration)
        try {
          navigator.mediaSession.setPositionState({
            duration,
            position,
            playbackRate: 1,
          });
        } catch {}
    }
  }, [currentTrack, currentAlbum, playing, position, duration]);
  return {
    audio,
    queue,
    queueIndex,
    current,
    playing,
    position,
    duration,
    currentTrack,
    currentAlbum,
    tracks,
    playTracks,
    jump,
    toggle,
    seek,
    stop,
    enqueue: (track: Track) => {
      setQueue((q) => [...q, track.id]);
      notifyRef.current("Added to your queue.");
    },
    removeQueue: (index: number) => {
      if (index !== queueIndex) {
        setQueue((q) => q.filter((_, i) => i !== index));
        if (index < queueIndex) setQueueIndex((q) => q - 1);
      }
    },
    selectQueue,
    events: {
      onPlay: () => setPlaying(true),
      onPause: () => {
        setPlaying(false);
        void persistRef.current(true);
      },
      onTimeUpdate: () => {
        setPosition(audio.current?.currentTime ?? 0);
        void persistRef.current();
      },
      onLoadedMetadata: () => {
        const value = audio.current?.duration ?? 0;
        setDuration(
          Number.isFinite(value) ? value : (currentTrack?.duration ?? 0),
        );
        if (restorePosition.current && audio.current) {
          audio.current.currentTime = restorePosition.current;
          restorePosition.current = 0;
        }
      },
      onEnded: () => {
        setPlaying(false);
        jump(1);
      },
      onError: () => {
        if (audio.current?.getAttribute("src"))
          notifyRef.current(
            "This track could not play. Check your connection or whether this browser supports its codec.",
          );
      },
    },
  };
}
