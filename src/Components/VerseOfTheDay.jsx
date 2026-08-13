import { createEffect, onCleanup } from "solid-js";
import { setVotdData, bible1 } from "../State/globalSignals.js";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "votd:pick";
const FALLBACK_TRANSLATION = "eng_kjv";

// Inclusive random integer in [min, max]
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// --- Local-day helpers ------------------------------------------------------

function getLocalDayInfo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dateKey = `${y}-${m}-${d}`;
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return {
    dateKey,
    msUntilLocalMidnight: nextMidnight.getTime() - now.getTime(),
  };
}

// --- localStorage helpers ---------------------------------------------------
// Storage now holds ONLY the day-locked reference (book/chapter/verse).
// Translation + text are resolved live from the currently loaded translation.

function loadStoredPick() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.dateKey !== "string" || typeof parsed.bookIndex !== "string" || typeof parsed.bookName !== "string" || typeof parsed.chapter !== "number" || typeof parsed.verse !== "number" || typeof parsed.reference !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredPick(entry) {
  try {
    // Persist ONLY the fixed reference — no text, no translation.
    const { dateKey, bookIndex, bookName, chapter, verse, reference } = entry;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateKey, bookIndex, bookName, chapter, verse, reference }));
  } catch {}
}

// --- Verse fetching ---------------------------------------------------------

async function fetchVerseText(translation, bookCode, chapter, verse) {
  const tFile = translation + ".dba";
  try {
    const row = await invoke("get_verse", {
      t: tFile,
      b: bookCode,
      c: chapter,
      v: verse,
    });
    const text = row?.text ?? row?.verseText ?? row?.body ?? row?.content ?? "";
    return text || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

export default function VerseOfTheDay(props) {
  const emit = (result) => {
    setVotdData(result);
    props.onPick?.(result);
  };

  // Resolve text for the given stored reference using the CURRENT translation,
  // falling back to eng_kjv if the current translation doesn't contain it.
  const emitStoredWithCurrentTranslation = async (stored) => {
    const currentTranslation = bible1();

    let text = await fetchVerseText(currentTranslation, stored.bookIndex, stored.chapter, stored.verse);
    let usedTranslation = currentTranslation;

    if (!text && currentTranslation !== FALLBACK_TRANSLATION) {
      text = await fetchVerseText(FALLBACK_TRANSLATION, stored.bookIndex, stored.chapter, stored.verse);
      usedTranslation = FALLBACK_TRANSLATION;
    }

    emit({
      ...stored,
      text: text || "",
      translation: usedTranslation,
      ...(text ? {} : { error: "Verse not available in current or fallback translation." }),
    });
  };

  // Generate a fresh pick from whatever books the current translation has,
  // fetch its text, and persist the REFERENCE (no text/translation) to storage.
  const generateFresh = async (dateKey) => {
    const translation = bible1();
    const tFile = translation + ".dba";

    try {
      const allBooks = await invoke("get_books", { translationFile: tFile });
      const candidates = (allBooks || []).filter((b) => !b.is_apocryphal);
      if (!candidates.length) {
        throw new Error(`Translation "${translation}" has no books.`);
      }

      // Retry loop in case a randomly chosen chapter/verse turns up empty
      // in a sparse translation.
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const book = candidates[randInt(0, candidates.length - 1)];
        const bookCode = book.id;
        const chapter = randInt(1, book.chapter_count);

        const totalVerses = await invoke("get_verse_count", {
          t: tFile,
          b: bookCode,
          c: chapter,
        });
        if (!totalVerses || totalVerses < 1) continue;

        const verse = randInt(1, totalVerses);

        const text = await fetchVerseText(translation, bookCode, chapter, verse);
        if (!text) continue;

        const displayName = book.english_name || book.name;
        const reference = `${displayName} ${chapter}:${verse}`;

        const stored = {
          dateKey,
          bookIndex: bookCode,
          bookName: displayName,
          chapter,
          verse,
          reference,
        };

        // Persist only the reference — text/translation are live.
        saveStoredPick(stored);

        emit({
          ...stored,
          text,
          translation,
        });
        return;
      }

      throw new Error(`Could not find a valid verse in "${translation}" after ${maxAttempts} attempts.`);
    } catch (err) {
      console.error("VerseOfTheDay generate failed:", err);
      // NOTE: do NOT persist errors — leave storage untouched so a later
      // retry (e.g., translation change) can produce a real pick.
      emit({
        dateKey,
        bookIndex: "",
        bookName: "",
        chapter: 0,
        verse: 0,
        reference: "",
        text: "",
        translation: bible1(),
        error: String(err),
      });
    }
  };

  const loadForToday = async () => {
    const { dateKey } = getLocalDayInfo();
    const stored = loadStoredPick();

    if (stored && stored.dateKey === dateKey) {
      // Reference is locked for the day; render it in the current translation.
      await emitStoredWithCurrentTranslation(stored);
      return;
    }

    // New day (or no stored pick, or corrupted storage) → generate fresh.
    await generateFresh(dateKey);
  };

  loadForToday();

  // Re-render the stored reference whenever the user swaps translations.
  // We deliberately do NOT re-pick a new verse here — only re-resolve text.
  createEffect(() => {
    const _translation = bible1(); // track dependency
    const { dateKey } = getLocalDayInfo();
    const stored = loadStoredPick();
    if (stored && stored.dateKey === dateKey) {
      // Fire and forget — emit will update the global signal.
      emitStoredWithCurrentTranslation(stored);
    }
    // If no stored pick yet for today, the initial loadForToday() /
    // midnight timer will handle generation; nothing to do here.
  });

  // Midnight rollover — force a fresh generation for the new day.
  let midnightTimer;
  const scheduleMidnight = () => {
    const { msUntilLocalMidnight } = getLocalDayInfo();
    midnightTimer = setTimeout(async () => {
      const { dateKey } = getLocalDayInfo();
      await generateFresh(dateKey);
      scheduleMidnight();
    }, msUntilLocalMidnight + 500);
  };
  scheduleMidnight();

  onCleanup(() => {
    if (midnightTimer) clearTimeout(midnightTimer);
  });

  return null; // headless — consumers read via global signal
}
