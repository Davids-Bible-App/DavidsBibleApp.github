import { createEffect, createSignal, onCleanup, onMount, For, untrack, on } from "solid-js";
import { Portal } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { open, message } from "@tauri-apps/plugin-dialog";
import { appDataDir, join } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import CountdownTimer from "./CountdownTimer.jsx";

import { getBook, clickOutside } from "../lib/functions";
import { bookOrderNo, book, chapterNo, numberOfChapters, setChapterNo, setChapterBtn } from "../State/globalSignals.js";
import { play, pause, stop, resume, next, previous, seek, getState, setPlayingQueue, clearPlayingQueue, setPlayMode } from "tauri-plugin-music-notification-api";
import { onPlay, onPause, onNext, onPrev, onQueueEnded, onPreviousAlbumNeeded } from "tauri-plugin-music-notification-api";
import handlePageChange from "../lib/handlePageChange.js";
import { stopService, isServiceRunning } from "tauri-plugin-background-service";
import "./CSS/Audio.css";

export default function Audio(props) {
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [audioVersion, setAudioVersion] = createSignal("");
  const [autoScroll, setAutoScroll] = createSignal(false);

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [advanceMode, setAdvanceMode] = createSignal("books");
  const [playableSrc, setPlayableSrc] = createSignal("");

  const [authors, setAuthors] = createSignal([]);
  const [isImporting, setIsImporting] = createSignal(false);
  const [importProgress, setImportProgress] = createSignal(0);

  const [position, setPosition] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [playlist, setPlaylist] = createSignal([]);
  const [track, setTrack] = createSignal({});
  const [loopMode, setLoopMode] = createSignal("off"); // "off" | "chapter" | "book"
  const [hasMounted, setHasMounted] = createSignal(false);

  let audioRef;
  let skipNativePlay = false;
  let queueTransitioning = false;
  let queueEndedTrigger = false;
  // NEW: When the OS asked to go to the previous album/book, we want the next
  // queue rebuild to start at the LAST chapter, not chapter 1.
  let pendingStartAtLastChapter = false;
  let playlistDebounceTimer;
  let windowsDebounceTimer;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const [isScreenUnlocked, setIsScreenUnlocked] = createSignal(document.visibilityState === "visible");

  // ===== EVENT LISTENERS SETUP =====
  onMount(() => {
    // Defer past the first paint so listener registration doesn't block startup
    queueMicrotask(async () => {
      if (type() === "android") {
        const handleVisibility = () => {
          setIsScreenUnlocked(document.visibilityState === "visible");
        };
        window.addEventListener("visibilitychange", handleVisibility);

        // Parallelize the 6 IPC round-trips
        const [unPlay, unPause, unNext, unPrev, unPrevAlbum, unQueueEnded] = await Promise.all([
          onPlay((e) => {
            console.log("[onPlay] event received");
            setIsPlaying(true);
          }),
          onPause(() => {
            console.log("[onPause] event received");
            setIsPlaying(false);
          }),
          onNext((e) => {
            skipNativePlay = true;
            console.log("[onNext] event received");

            // ── CHANGE START ──────────────────────────────────────────────────────
            if (loopMode() === "chapter") {
              // Plugin still fires onNext at end-of-track even in loop mode.
              // Replay the current chapter in JS instead of advancing.
              const list = untrack(playlist);
              const currentTrack = list?.[untrack(chapterNo) - 1];
              const author = audioVersion();

              if (currentTrack) {
                play({
                  url: currentTrack.url,
                  title: currentTrack.name,
                  artist: author,
                  album: currentTrack.name,
                }).catch((e) => console.warn("[loop chapter] replay failed:", e));
              }
              skipNativePlay = false; // chapterNo isn't changing, so EFFECT 2 won't fire
              return;
            }

            handlePageChange(1, props.helpers);
          }),
          onPrev((e) => {
            skipNativePlay = true;
            console.log("[onPrev] event received");
            handlePageChange(-1, props.helpers);
          }),
          onPreviousAlbumNeeded(async (event) => {
            console.log("[EVENT] onPreviousAlbumNeeded received. Going to previous book's last chapter.");
            pendingStartAtLastChapter = true;
            queueEndedTrigger = true;
            queueTransitioning = true;
            setIsPlaying(true);
            handlePageChange(-1, props.helpers);
          }),
          onQueueEnded(async (event) => {
            console.log("[EVENT] onQueueEnded received. loopMode:", loopMode(), "advanceMode:", advanceMode());

            // ── CHANGE START ──────────────────────────────────────────────────
            if (loopMode() === "chapter") {
              // Last chapter ended — replay it, same as the onNext intercept does
              // for all other chapters.
              const list = untrack(playlist);
              const currentTrack = list?.[untrack(chapterNo) - 1];
              const author = audioVersion();
              if (currentTrack) {
                await play({
                  url: currentTrack.url,
                  title: currentTrack.name,
                  artist: author,
                  album: currentTrack.name,
                }).catch((e) => console.warn("[loop chapter] last chapter replay failed:", e));
              }
            } else if (loopMode() === "book") {
              // ── CHANGE END ────────────────────────────────────────────────────
              await restartCurrentBook();
            } else {
              queueEndedTrigger = true;
              queueTransitioning = true;

              if (advanceMode() === "books") {
                // Auto-advance (books mode) OR user deliberately pressed Next on last chapter
                setIsPlaying(true);
                handlePageChange(1, props.helpers);
              } else {
                setIsPlaying(false);
                setProgress(0);
                await stop().catch((e) => console.warn("[EVENT] Stop after queue end (book mode) failed:", e));

                queueTransitioning = false;
                queueEndedTrigger = false;
              }
            }
          }),
        ]);

        const unlisteners = [unPlay, unPause, unNext, unPrev, unPrevAlbum, unQueueEnded];
        console.log("[LISTENERS] Registered 6 event listeners");

        onCleanup(() => {
          console.log("[LISTENERS] Cleaning up event listeners");
          window.removeEventListener("visibilitychange", handleVisibility);
          unlisteners.forEach((u) => {
            if (typeof u === "function") u();
          });
        });
      }
      await fetchAuthors();
    });
  });

  onMount(() => setHasMounted(true));

  const fetchAuthors = async () => {
    try {
      const fetchedAuthors = await invoke("get_available_authors");
      setAuthors(fetchedAuthors);

      if (fetchedAuthors.length > 0) {
        const saved = localStorage.getItem("audioVersion");
        // Use saved value only if it still exists in the available authors list
        const resolved = saved && fetchedAuthors.includes(saved) ? saved : fetchedAuthors[0];
        if (!audioVersion()) setAudioVersion(resolved);
      }
    } catch (err) {
      console.error("Failed to load authors:", err);
    }
  };

  // === EFFECT 1: Build Android Playlist (Runs ONLY when Book/Author changes) ===

  createEffect(() => {
    if (type() !== "android") return;

    const activeBookId = book();
    const order = bookOrderNo();
    const author = audioVersion();

    if (!activeBookId || !author) return;

    queueTransitioning = true;

    // Clear the playlist instantly so EFFECT 2 doesn't try to play the old book
    setPlaylist([]);

    // Untrack chapterNo so normal track progression doesn't destroy the queue!
    let initialChapter = untrack(chapterNo);

    clearTimeout(playlistDebounceTimer);

    // CRITICAL: Skip debounce when triggered by onQueueEnded or onPreviousAlbumNeeded.
    const shouldSkipDebounce = queueEndedTrigger;
    const delay = shouldSkipDebounce ? 0 : 50;

    // Capture and consume the "start at last chapter" flag for this rebuild.
    const startAtLast = pendingStartAtLastChapter;
    pendingStartAtLastChapter = false;

    const rebuildQueue = async () => {
      try {
        const orderStr = String(order || 1).padStart(2, "0");
        const name = getBook(activeBookId) || "Genesis";
        const safeName = name.replace(/\s+/g, "");
        // const padLength = name === "Psalms" ? 3 : 2;

        const basePath = await appDataDir();
        const bookFolderPath = await join(basePath, "audio", author, `${orderStr}_${safeName}`);
        const allChapters = await invoke("get_book_playlist", {
          folderPath: bookFolderPath,
        });

        const formattedPlaylist = allChapters.map((path, index) => ({
          id: index,
          name: path.split(/[\\/]/).pop().replace(".m4a", ""),
          url: path,
          path: path,
          artist: author,
          lufs: null,
          coverUrl: "",
        }));

        // If we were asked to start at the last chapter (previous-album path),
        // override the initialChapter to the final track of this new book.
        if (startAtLast && formattedPlaylist.length > 0) {
          initialChapter = formattedPlaylist.length;
          // Sync the global chapter signal so the UI reflects the last chapter.
          setChapterNo(initialChapter);
          setChapterBtn(initialChapter);
          console.log("[EFFECT 1] Previous-album path: starting at last chapter =", initialChapter);
        }

        setPlaylist(formattedPlaylist);

        // CRITICAL: Only manage MediaSession queue if user is already playing.
        // This prevents the media tray from appearing on app startup.
        const shouldAutoPlay = untrack(isPlaying);

        if (shouldAutoPlay) {
          // User is actively playing: clear old queue and set new one before continuing playback
          await stop().catch((e) => console.warn("Stop before queue clear failed:", e));
          await clearPlayingQueue().catch((e) => console.warn("Queue clear failed:", e));

          if (isScreenUnlocked()) {
            // Small delay to allow MediaSession to reset
            await wait(100);
          }

          await setPlayingQueue(
            {
              songs: formattedPlaylist,
              currentIndex: initialChapter > 0 ? initialChapter - 1 : 0,
            },
            "sequential",
          ).catch((err) => console.error("Failed to set playing queue:", err));

          if (formattedPlaylist.length > 0) {
            const startIndex = initialChapter > 0 ? initialChapter - 1 : 0;
            const firstTrack = formattedPlaylist[startIndex];

            await play({
              url: firstTrack.url,
              title: firstTrack.name,
              artist: author,
              album: firstTrack.name,
            }).catch((err) => console.error("[EFFECT 1] Auto-play failed:", err));
          }
        } else {
          // User is not playing: don't show media tray, just prepare internally
          // Stop any residual playback and clear queue without notifying MediaSession
          await stop().catch((e) => console.warn("Stop failed:", e));
          await clearPlayingQueue().catch((e) => console.warn("Queue clear failed:", e));
        }
      } catch (err) {
        console.error("Error loading book playlist:", err);
      } finally {
        queueTransitioning = false;
        // Clear the queue-ended trigger now that the rebuild is done.
        queueEndedTrigger = false;
      }
    };

    if (shouldSkipDebounce) {
      // Run immediately when triggered by onQueueEnded / onPreviousAlbumNeeded
      rebuildQueue();
    } else {
      // Debounce for user interactions
      playlistDebounceTimer = setTimeout(rebuildQueue, delay);
    }
  });

  // === EFFECT 2: Handle Track Navigation & Windows Files ===
  createEffect(
    on(
      [book, chapterNo, bookOrderNo, audioVersion],
      ([activeBookId, activeChapter, order, author]) => {
        if (!hasMounted()) return;
        if (!activeBookId || !activeChapter || !author) return;

        if (type() === "windows") {
          clearTimeout(windowsDebounceTimer);
          windowsDebounceTimer = setTimeout(async () => {
            try {
              const orderStr = String(order || 1).padStart(2, "0");
              const name = getBook(activeBookId) || "Genesis";
              const safeName = name.replace(/\s+/g, "");
              const padLength = name === "Psalms" ? 3 : 2;
              const chap = String(activeChapter || 1).padStart(padLength, "0");

              const basePath = await appDataDir();
              const path = await join(basePath, "audio", author, `${orderStr}_${safeName}`, `${safeName}_${chap}.m4a`);

              const bytes = await invoke("read_audio_file", { path });
              const blob = new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });
              const newUrl = URL.createObjectURL(blob);

              setPlayableSrc((prevUrl) => {
                if (prevUrl) URL.revokeObjectURL(prevUrl);
                return newUrl;
              });
            } catch (err) {
              console.info("Missing audio file:", err);
              setPlayableSrc("");
            }
          }, 150);
        }

        if (type() === "android") {
          setTrack(playlist()?.[chapterNo() - 1]);

          if (queueTransitioning) {
            skipNativePlay = false;
            return;
          }

          if (skipNativePlay) {
            skipNativePlay = false;
            const list = playlist();
            const currentTrack = list?.[activeChapter - 1];
            if (currentTrack) {
              play({
                url: currentTrack.url,
                title: currentTrack.name,
                artist: author,
                album: currentTrack.name,
              }).catch((e) => console.warn("Artist metadata update failed", e));
            }
            return;
          }

          const list = playlist();

          if (list.length > 0 && untrack(isPlaying)) {
            // Currently playing: jump to the new chapter immediately
            const track = list[activeChapter - 1];
            if (track) {
              play({
                url: track.url,
                title: track.name,
                artist: author,
                album: track.name,
              }).catch((e) => console.warn("Interrupted play jump", e));
            }
          } else if (list.length > 0) {
            // Paused: wipe the plugin's internal cursor so the next play()
            // call in togglePlay starts at the correct chapter, not the old one.
            // stop()+clearPlayingQueue() resets state without triggering playback.
            stop().catch((e) => console.warn("[EFFECT 2] stop on pause-chapter-change failed:", e));
            clearPlayingQueue().catch((e) => console.warn("[EFFECT 2] clearPlayingQueue on pause-chapter-change failed:", e));
          }
        }
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    clearTimeout(playlistDebounceTimer);
    clearTimeout(windowsDebounceTimer);
    if (type() === "windows") {
      if (playableSrc()) URL.revokeObjectURL(playableSrc());
    }

    (async () => {
      try {
        if (await isServiceRunning()) {
          await stopService();
        }
      } catch (e) {
        console.error("[BG] stopService on cleanup failed", e);
      }
    })();
  });

  // 2. Handle Autoplay safely when src changes
  createEffect((prevSrc) => {
    if (type() === "windows") {
      const currentSrc = playableSrc();
      if (currentSrc && currentSrc !== prevSrc && audioRef) {
        if (isPlaying()) {
          setTimeout(() => {
            audioRef.play().catch((e) => {
              console.warn("Autoplay interrupted or missing file:", e);
              setIsPlaying(false);
            });
          }, 50);
        }
      }
      return currentSrc;
    }
  });

  const handleTimeUpdate = () => {
    if (type() === "windows") {
      if (audioRef && audioRef.duration) {
        const currentProgress = audioRef.currentTime / audioRef.duration;
        setProgress(currentProgress * 100);

        // Add these two — convert seconds → ms to match Android's formatTime format
        setPosition(audioRef.currentTime * 1000);
        setDuration(audioRef.duration * 1000);

        if (autoScroll()) {
          const container = props.helpers.psr();
          if (container) {
            const maxScroll = container.scrollHeight - container.clientHeight;
            container.scrollTop = currentProgress * maxScroll;
          }
        }
      }
    }
  };

  const [hasState, setHasState] = createSignal(false);
  createEffect(() => {
    if (isPlaying() && type() === "android") {
      const interval = setInterval(async () => {
        let state;
        try {
          state = await getState();
          setHasState(state ? true : false);
          if (state) {
            setPosition(state.position);
            setDuration(state.duration);

            if (state.duration > 0) {
              const currentProgress = state.position / state.duration;
              setProgress(currentProgress * 100);

              if (autoScroll()) {
                const container = props.helpers.psr();
                if (container) {
                  const maxScroll = container.scrollHeight - container.clientHeight;
                  container.scrollTop = currentProgress * maxScroll;
                }
              }
            }
          }
        } catch (err) {
          console.warn("Failed to get player state, skipping update:", err);
        }

        if (state && !isPlaying()) {
          clearInterval(interval);
        }
      }, 500);

      onCleanup(() => clearInterval(interval));
    }
  });

  const handleEnded = () => {
    if (type() === "windows") {
      setProgress(0);
      const isLastChapter = chapterNo() === numberOfChapters();

      // ── chapter loop: replay in place ──────────────────────────────────────
      if (loopMode() === "chapter") {
        if (audioRef) {
          audioRef.currentTime = 0;
          audioRef.play().catch((e) => console.warn("[loop chapter] Windows replay failed:", e));
        }
        return;
      }

      // ── book loop: restart from ch.1 on last chapter, else advance ──────────
      if (loopMode() === "book") {
        if (isLastChapter) {
          restartCurrentBookWindows();
        } else {
          handlePageChange(1, props.helpers);
        }
        return;
      }

      // ── loop off (original behaviour) ───────────────────────────────────────
      if (advanceMode() === "book" && isLastChapter) {
        setIsPlaying(false);
        return;
      }

      handlePageChange(1, props.helpers);
    }
  };

  const togglePlay = async () => {
    if (type() === "windows") {
      if (!audioRef) return;
      if (isPlaying()) {
        audioRef.pause();
      } else {
        audioRef.play().catch((e) => {
          console.info("Audio play failed:", e);
        });
      }
      setIsPlaying(!isPlaying());
    }
    if (type() === "android") {
      const currentlyPlaying = isPlaying();
      console.log("[togglePlay] Called. Currently playing:", currentlyPlaying, "Book:", book(), "Chapter:", chapterNo());

      if (currentlyPlaying) {
        await pause().catch((e) => console.warn("[togglePlay] Pause failed:", e));
        setIsPlaying(false);
      } else {
        const list = playlist();
        const currentIndex = chapterNo() - 1;

        if (list && list.length > currentIndex && currentIndex >= 0) {
          const track = list[currentIndex];

          try {
            // CRITICAL: Set the queue BEFORE playing so MediaSession appears at the right time
            await setPlayingQueue(
              {
                songs: list,
                currentIndex: currentIndex,
              },
              "sequential",
            ).catch((err) => console.warn("[togglePlay] setPlayingQueue failed:", err));

            await play({
              url: track.url,
              title: track.name,
              artist: audioVersion(),
              album: track.name,
            });

            setIsPlaying(true);
          } catch (err) {
            console.error("[togglePlay] Android play failed:", err);
            setIsPlaying(false);
          }
        } else {
          setIsPlaying(false);
        }
      }
    }
  };

  const handlePrev = async () => {
    type() === "android" ? await previous() : handlePageChange(-1, props.helpers);
  };
  // AFTER
  const handleNext = async () => {
    if (type() === "android") {
      const isLastChapter = chapterNo() === numberOfChapters();
      if (isLastChapter) {
        // Bypass onQueueEnded entirely — go straight to the next book.
        // queueEndedTrigger skips the debounce in EFFECT 1 so the rebuild
        // is immediate. isPlaying is NOT forced, so if the user is paused
        // they stay paused on chapter 1 of the new book.
        queueEndedTrigger = true;
        queueTransitioning = true;
        handlePageChange(1, props.helpers);
      } else {
        await next(); // Normal within-book chapter advance
      }
    } else {
      handlePageChange(1, props.helpers); // Windows unchanged
    }
  };

  // ── Loop mode ─────────────────────────────────────────────────────────────
  const LOOP_MODES = ["off", "chapter", "book"];
  const LOOP_LABELS = { off: "Off", chapter: "Chap", book: "Book" };

  const cycleLoopMode = async () => {
    const next = LOOP_MODES[(LOOP_MODES.indexOf(loopMode()) + 1) % LOOP_MODES.length];
    setLoopMode(next);

    if (type() === "android") {
      // Always stay in sequential — chapter and book looping are handled in JS
      await setPlayMode("sequential").catch((err) => console.warn("[loopMode] setPlayMode failed:", err));
    }
  };

  // ── Restart current book from chapter 1 (used by "loop book") ─────────────
  const restartCurrentBook = async () => {
    const list = untrack(playlist);
    if (!list || list.length === 0) return;

    const author = audioVersion();
    const firstTrack = list[0];

    setChapterNo(1);
    setChapterBtn(1);

    queueEndedTrigger = true;
    queueTransitioning = true;

    await stop().catch((e) => console.warn("[restartBook] stop failed:", e));
    await clearPlayingQueue().catch((e) => console.warn("[restartBook] clear failed:", e));

    await setPlayingQueue({ songs: list, currentIndex: 0 }, "sequential").catch((err) => console.error("[restartBook] setPlayingQueue failed:", err));

    if (untrack(isPlaying)) {
      await play({
        url: firstTrack.url,
        title: firstTrack.name,
        artist: author,
        album: firstTrack.name,
      }).catch((err) => console.error("[restartBook] play failed:", err));
    }

    queueTransitioning = false;
    queueEndedTrigger = false;
  };
  // ── Restart book (Windows) ──────────────────────────────────────────────────
  const restartCurrentBookWindows = () => {
    setChapterNo(1);
    setChapterBtn(1);
    // EFFECT 2 reacts to chapterNo → loads new src.
    // The autoplay createEffect fires because isPlaying() stays true.
  };

  const formatTime = (ms) => {
    if (!ms) return "0:00";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor(ms / (1000 * 60));
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const circleRadius = 36;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const strokeOffset = () => circleCircumference - (progress() / 100) * circleCircumference;

  const cycleAdvanceMode = () => {
    const modes = ["books", "book"];
    const nextIndex = (modes.indexOf(advanceMode()) + 1) % modes.length;
    setAdvanceMode(modes[nextIndex]);
  };

  const handleGenericImport = async () => {
    setMenuOpen(false);

    try {
      const source = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Zip Archive", extensions: ["zip"] }],
      });

      if (!source) return;
      const sourcePath = typeof source === "string" ? source : source.path;

      // ✅ Show modal & block button BEFORE invoke — no more blank wait
      setIsImporting(true);
      setImportProgress(0);

      const unlisten = await listen("import-progress", (event) => {
        setImportProgress(event.payload.progress);
      });

      const author = await invoke("import_audio_zip", { sourceUri: sourcePath });

      unlisten();
      setIsImporting(false);

      await message(`${author} audio extracted successfully!`);
      await fetchAuthors();
      // setAudioVersion(author); // leave for saved author restore
    } catch (err) {
      setIsImporting(false);
      console.error("Import failed:", err);
      await message(err.toString(), { title: "Error", kind: "error" });
    }
  };

  const handleDeleteAuthor = async () => {
    const author = audioVersion(); // whichever author is currently selected
    if (!author) {
      await message("No author selected to delete.", { title: "Notice", kind: "warning" });
      return;
    }

    const confirmed = await message(`Delete all audio for "${author}"? This cannot be undone.`, {
      title: "Confirm Delete",
      kind: "warning",
    });
    if (!confirmed) return;

    setMenuOpen(false);

    try {
      await invoke("delete_author", { author });
      await message(`"${author}" deleted successfully.`);
      await fetchAuthors();
      const remaining = authors(); // whatever your authors signal is called
      setAudioVersion(remaining.length > 0 ? remaining[0] : "");
    } catch (err) {
      console.error("Delete failed:", err);
      await message(err.toString(), { title: "Error", kind: "error" });
    }
  };

  return (
    <footer class={`Audio-footer`}>
      <nav class="Audio-nav">
        <audio ref={audioRef} src={playableSrc()} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} />

        <div class="Audio-content">
          <div class="Audio-controls-wrapper">
            <div class="Audio-header-row">
              <select
                class="Audio-selectbox neu-button"
                value={audioVersion()}
                onChange={(e) => {
                  setAudioVersion(e.target.value);
                  localStorage.setItem("audioVersion", e.target.value);
                }}
                disabled={authors().length === 0}
              >
                <For each={authors()}>{(author) => <option value={author}>{author}</option>}</For>
              </select>
            </div>
            <div class="Audio-btn-row">
              <button class={`neu-button Audio-scroll ${autoScroll() ? "active-scroll" : ""}`} onClick={() => setAutoScroll(!autoScroll())} style={autoScroll() ? "background: var(--controls-pressed-button-front-gradient); color: white;" : ""}>
                Scroll&nbsp;&nbsp;
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-mouse" viewBox="0 0 16 16">
                  <path d="M8 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 3m4 8a4 4 0 0 1-8 0V5a4 4 0 1 1 8 0zM8 0a5 5 0 0 0-5 5v6a5 5 0 0 0 10 0V5a5 5 0 0 0-5-5" />
                </svg>
              </button>

              <button class={`neu-button Audio-loop ${loopMode() !== "off" ? "loop-active" : ""}`} onClick={cycleLoopMode} style={loopMode() !== "off" ? "background: var(--controls-pressed-button-front-gradient); color: white;" : ""}>
                {LOOP_LABELS[loopMode()]}&emsp;
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-repeat" viewBox="0 0 16 16">
                  <path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z" />
                </svg>
              </button>
            </div>

            <div class="Audio-btn-row">
              <button class="Audio-button neu-button" onClick={handlePrev}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="19 20 9 12 19 4 19 20"></polygon>
                  <line x1="5" y1="19" x2="5" y2="5"></line>
                </svg>
              </button>

              <div class="Audio-play-wrapper" onClick={togglePlay}>
                <svg class="Audio-progress-ring" width="84" height="84">
                  <circle stroke="rgba(255,255,255,0.05)" stroke-width="4" fill="transparent" r={circleRadius} cx="42" cy="42" />
                  <circle class="Audio-progress-circle" stroke-width="4" fill="transparent" r={circleRadius} cx="42" cy="42" style={{ "stroke-dasharray": circleCircumference, "stroke-dashoffset": strokeOffset() }} />
                </svg>

                <button class={`Audio-button neu-button play-btn ${isPlaying() ? "pressed" : ""}`}>
                  {isPlaying() ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16"></rect>
                      <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                  ) : (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                </button>
              </div>

              <button class="Audio-button neu-button" onClick={handleNext}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 4 15 12 5 20 5 4"></polygon>
                  <line x1="19" y1="5" x2="19" y2="19"></line>
                </svg>
              </button>
            </div>
            <div class="Audio-btn-row">
              <div class="progress-container">
                <span>{formatTime(position())}</span>

                <input
                  type="range"
                  min="0"
                  max={duration() || 100}
                  value={position()}
                  onInput={(e) => {
                    const newPos = parseInt(e.target.value);
                    setPosition(newPos);
                    if (type() === "android") {
                      seek(newPos);
                    } else if (type() === "windows" && audioRef) {
                      audioRef.currentTime = newPos / 1000; // ms → seconds
                    }
                  }}
                />
                <style jsx>{`
                  .Audio-btn-row input[type="range"]::-webkit-slider-thumb {
                    background-color: ${isPlaying() && "#d93d07"};
                  }
                `}</style>

                <span>{formatTime(duration())}</span>
              </div>
            </div>
          </div>
          <div class="Audio-menu-container">
            <button class="Audio-menu-btn" onClick={() => setMenuOpen(!menuOpen())}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--main-icon-text-color)">
                <circle cx="12" cy="5" r="2"></circle>
                <circle cx="12" cy="12" r="2"></circle>
                <circle cx="12" cy="19" r="2"></circle>
              </svg>
            </button>

            {menuOpen() && (
              <div class="Audio-dropdown">
                <div style="padding: 8px; display: flex; flex-direction: column; gap: 8px;">
                  <button onClick={handleGenericImport} disabled={isImporting()}>
                    {isImporting() ? "Importing..." : "Import Zip"}
                  </button>
                  <button onClick={handleDeleteAuthor} disabled={isImporting() || !audioVersion()}>
                    Delete Author
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
      <CountdownTimer audioRef={audioRef} playableSrc={playableSrc} togglePlay={togglePlay} hasState={hasState} pause={pause} resume={resume} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />
      <Portal>
        <Show when={isImporting()}>
          <div class="Import-modal-overlay">
            <div class="Import-modal-content">
              <h3>Unpacking Audio...</h3>
              <p>Please be patient while we upload and unpack the files. This may take a minute.</p>

              {/* Visual Progress Bar */}
              <div class="Progress-bar-container">
                <div class="Progress-bar-fill" style={{ width: `${importProgress()}%` }}></div>
              </div>

              {/* Percentage Text */}
              <p class="Progress-text">{Math.round(importProgress())}% Complete</p>
            </div>
          </div>
        </Show>
      </Portal>
    </footer>
  );
}
