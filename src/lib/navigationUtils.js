// lib/navigationUtils.js
import { dbaExists } from "./functions.js";
import { showToast } from "../Components/Toast";
import { updateAndLogScripture } from "../State/historyStore";
// Import the global setters
import {
  setBible1,
  setBook,
  setChapterNo,
  setTargetVerse,
  setChapterBtn,
  setTestamentBtn,
  bookOrderNo,
} from "../State/globalSignals.js";

export const executeJumpTo = async (rawHit, onSuccess) => {
  // 1. Normalize the Data
  const rawTranslation = rawHit.translation_id || rawHit.translationId || rawHit.translation || "";
  const hit = {
    translation_id: rawTranslation.replace(/\.dba$/i, ""),
    book_id: rawHit.book_id || rawHit.bookId,
    chapter: parseInt(rawHit.chapter || rawHit.chapterNumber),
    verse_id: parseInt(rawHit.verse_id || rawHit.verseNumber || rawHit.verse || 1),
  };

  // 2. File Check
  const installed = await dbaExists(`${hit.translation_id}.dba`);
  if (!installed) {
    showToast(`Translation (${hit.translation_id}) Not Installed`, "error", 5000, true);
    return;
  }

  // 3. Update Global State Directly
  setBible1(hit.translation_id);
  setBook(hit.book_id);
  setChapterNo(hit.chapter);
  setTargetVerse(hit.verse_id);

  updateAndLogScripture(hit);

  if (typeof onSuccess === "function") {
    onSuccess();
  }

  // 4. Handle UI Feedback (Scrolling & Buttons)
  setTimeout(() => {
    const el = document.querySelector(".highlight-pulse");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });

    setChapterBtn(hit.chapter);

    if (typeof bookOrderNo() === "number") {
      bookOrderNo() <= 39 ? setTestamentBtn("ot") : setTestamentBtn("nt");
    }

    setTimeout(() => setTargetVerse(null), 2500);
  }, 200);
};
