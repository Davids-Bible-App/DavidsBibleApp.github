// src/lib/bookmarkUtils.js
// Shared helpers for bookmark verse formatting.
import { executeJumpTo } from "./navigationUtils.js";
import { setTargetVerses } from "../State/globalSignals.js";
import { abbreviator, getBook } from "./functions";

/**
 * Compresses a sorted array of verse numbers into range strings.
 * [1, 3, 4, 5, 9, 11] → "1, 3-5, 9, 11"
 */
const compressVerses = (vss) => {
  const sorted = [...new Set(vss)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(", ");
};

/**
 * Formats an array of verse objects into a compact human-readable reference.
 *
 * Input:  [{tr:"eng_kjv", bk:"LUK", ch:1, vs:1}, {tr:"eng_kjv", bk:"LUK", ch:1, vs:3}, ...]
 * Output: "eng_kjv  ·  LUK 1:1, 3-5, 9"
 *
 * Handles multiple books/chapters gracefully:
 * "eng_kjv  ·  LUK 1:1-3  ·  JHN 3:16"
 */
export const formatVerseRefs = (verses) => {
  if (!verses?.length) return "";

  // Group by book + chapter (preserving insertion order)
  const groups = new Map();
  for (const v of verses) {
    const key = `${v.bk}|${v.ch}`;
    if (!groups.has(key)) groups.set(key, { bk: v.bk, ch: v.ch, vss: [] });
    groups.get(key).vss.push(parseInt(v.vs));
  }

  const parts = [];
  for (const { bk, ch, vss } of groups.values()) {
    parts.push(`${getBook(bk)} ${ch}:${compressVerses(vss)}`);
  }

  const tr = verses[0].tr ?? verses[0].ed ?? "";
  return `${abbreviator(tr)}  ·  ${parts.join("  ·  ")}`;
};

/**
 * Parses the stored verses JSON string back to an array.
 * Returns [] on any failure so callers never have to null-check.
 */
export const parseVerses = (json) => {
  try {
    return JSON.parse(json) ?? [];
  } catch {
    return [];
  }
};

// ─── Bookmark jump — navigates then underlines all verses ────────────────────

/**
 * Jumps to the chapter of the bookmark's first verse, then underlines
 * every verse in the collection. The underline lives in `targetVerses`
 * (a global signal) and is cleared by a `createEffect` in the reader
 * whenever the chapter changes.
 *
 * Usage in Bookmark.jsx:
 *   executeBookmarkJumpTo(parseVerses(bm.verses), () => setTrigger(""));
 *
 * Usage of the clear effect — add once inside your reader/chapter component:
 *   createEffect(on(chapterNo, (ch, prev) => {
 *     if (prev !== undefined) setTargetVerses(null);
 *   }, { defer: true }));
 */
export const executeBookmarkJumpTo = async (verses, onSuccess) => {
  if (!verses?.length) return;

  const first = verses[0];

  // Shape executeJumpTo expects
  const hit = {
    translation_id: first.tr,
    book_id: first.bk,
    chapter: parseInt(first.ch),
    verse_id: parseInt(first.vs),
  };

  // Navigate to the chapter (handles dba check, state, logging, scroll, buttons)
  await executeJumpTo(hit, onSuccess, false);

  // After the chapter has rendered, set the full verse-ID array.
  // 250 ms gives executeJumpTo's own 200 ms setTimeout time to settle.
  setTimeout(() => {
    setTargetVerses(verses.map((v) => parseInt(v.vs)));
  }, 250);
};
