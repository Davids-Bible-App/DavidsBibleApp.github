import { createEffect, createSignal, onCleanup, onMount, For, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { open, message } from "@tauri-apps/plugin-dialog";
import { appDataDir, join } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import CountdownTimer from "./CountdownTimer.jsx";

import { getBook, clickOutside } from "../lib/functions";
import { bookOrderNo, book, chapterNo, numberOfChapters, setChapterNo, setChapterBtn } from "../State/globalSignals.js";
import { play, pause, stop, resume, next, previous, seek, getState, setPlayingQueue, clearPlayingQueue } from "tauri-plugin-music-notification-api";
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
            console.log("[EVENT] onQueueEnded received. advanceMode:", advanceMode());
            pageBook();
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

  async function pageBook() {
    queueEndedTrigger = true;
    queueTransitioning = true;

    if (advanceMode() === "books") {
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

  const fetchAuthors = async () => {
    try {
      const fetchedAuthors = await invoke("get_available_authors");
      setAuthors(fetchedAuthors);

      // Auto-select the first author if one exists and none is currently selected
      if (fetchedAuthors.length > 0 && !audioVersion()) {
        setAudioVersion(fetchedAuthors[0]);
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

        // CRITICAL: Always clear queue AND stop playback before setting new queue
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

        // CRITICAL: Auto-play only if user has already initiated playback
        const shouldAutoPlay = untrack(isPlaying);

        if (shouldAutoPlay && formattedPlaylist.length > 0) {
          const startIndex = initialChapter > 0 ? initialChapter - 1 : 0;
          const firstTrack = formattedPlaylist[startIndex];

          await play({
            url: firstTrack.url,
            title: firstTrack.name,
            artist: author,
            album: firstTrack.name,
          }).catch((err) => console.error("[EFFECT 1] Auto-play failed:", err));
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
  createEffect(() => {
    const activeBookId = book();
    const activeChapter = chapterNo();
    const order = bookOrderNo();
    const author = audioVersion();

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
          const blob = new Blob([new Uint8Array(bytes)], {
            type: "audio/mpeg",
          });
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

      // If the OS lockscreen triggered this chapter change, skip manual playback.
      if (skipNativePlay || queueTransitioning) {
        skipNativePlay = false; // Reset the flag
        return;
      }

      // If it WASN'T native (e.g. user clicked Chapter 5 inside your app), force the jump.
      const list = playlist();
      if (list.length > 0 && untrack(isPlaying)) {
        const track = list[activeChapter - 1];
        if (track) {
          play({
            url: track.url,
            title: track.name,
            artist: author,
            album: track.name,
          }).catch((e) => console.warn("Interrupted play jump", e));
        }
      }
    }
  });

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
        const state = await getState();
        setHasState(state ? true : false);
        try {
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
            const bookName = getBook(book()) || "Genesis";

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
      setAudioVersion(author);
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
              <button class={`Audio-scroll ${autoScroll() ? "active-scroll" : ""}`} onClick={() => setAutoScroll(!autoScroll())} style={autoScroll() ? "background: var(--controls-pressed-button-front-gradient); color: white;" : ""}>
                Scroll
              </button>

              <select class="Audio-selectbox" value={audioVersion()} onChange={(e) => setAudioVersion(e.target.value)} disabled={authors().length === 0}>
                <For each={authors()}>{(author) => <option value={author}>{author}</option>}</For>
              </select>

              <button class="Audio-advance" onClick={cycleAdvanceMode} style={advanceMode() !== "books" ? "background: var(--controls-pressed-button-front-gradient); color: white;" : ""}>
                {advanceMode() === "books" ? "Books" : "Book"}
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
            {/* <Show when={type() === "android"}> */}
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
                  input[type="range"]::-webkit-slider-thumb {
                    background-color: ${isPlaying() && "#d93d07"};
                  }
                `}</style>

                <span>{formatTime(duration())}</span>
              </div>
            </div>
            {/* </Show> */}
          </div>
          <div class="Audio-menu-container">
            <button class="Audio-menu-btn" onClick={() => setMenuOpen(!menuOpen())}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--main-icon-text-color)">
                <circle cy="12" cx="5" r="2"></circle>
                <circle cy="12" cx="12" r="2"></circle>
                <circle cy="12" cx="19" r="2"></circle>
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
      <div class="Audio-info">
        {/*
        <code>forcePageBk: {forcePageBk() ? "true" : "false"}</code>
        <code>Raw Evaluate: {duration() - position() > 30000 ? "true" : "false"}</code>
        <code>Track Remaining: {formatTime(duration() - position())}</code> */}
        {/* <code>State: {hasState() ? "true" : "false"}</code>
        <code>Track Progress: {Math.trunc(parseFloat(progress()) * 1e4) / 1e4}</code>
        <code>Track Duration: {duration()}</code>
        <code>artist/author: {audioVersion()}</code>
        <code>activeBookId: {book()}</code>
        <code>album: {getBook(book())}</code>
        <code>activeChapter: {chapterNo()}</code>
        <code>order: {bookOrderNo()}</code>
        <code>Track ID: {JSON.stringify(track()?.id)}</code>
        <code>Track Name: {JSON.stringify(track()?.name)}</code>
        <code>Track URL: {track()?.url?.split("/").slice(-3).join("/") ?? ""}</code> */}
      </div>
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
