// lib/navigationUtils.js
import { batch } from "solid-js"; // ← ADD THIS
import { dbaExists } from "./functions.js";
import { showToast } from "../Components/Toast";
import { updateAndLogScripture } from "../State/historyStore";
import { setBible1, setBook, setChapterNo, setTargetVerse, setChapterBtn, setTestamentBtn, bookOrderNo } from "../State/globalSignals.js";

export const executeJumpTo = async (rawHit, onSuccess, pulse = true) => {
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

  // 3. Batch all signal updates so EFFECT 1 (which watches `book`) fires AFTER
  //    chapterNo is already set — preventing it from reading a stale chapter via untrack().
  batch(() => {
    setBible1(hit.translation_id);
    setBook(hit.book_id);
    setChapterNo(hit.chapter);
    setChapterBtn(hit.chapter); // ← Moved here from setTimeout: sidebar stays in sync immediately
    setTargetVerse(hit.verse_id);
  });

  updateAndLogScripture(hit);

  if (typeof onSuccess === "function") {
    onSuccess();
  }

  // 4. Handle UI Feedback (Scrolling only — state is already committed above)
  setTimeout(() => {
    const el = document.querySelector(".highlight-pulse");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!pulse) setTargetVerse(null);
    }

    if (typeof bookOrderNo() === "number") {
      bookOrderNo() <= 39 ? setTestamentBtn("ot") : setTestamentBtn("nt");
    }

    setTimeout(() => setTargetVerse(null), 2500);
  }, 200);
};
