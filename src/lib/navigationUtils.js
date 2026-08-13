import { batch } from "solid-js";
import { dbaExists } from "./functions.js";
import { showToast } from "../Components/Toast";
import { updateAndLogScripture } from "../State/historyStore";
import { setBible1, setBook, setChapterNo, setTargetVerse, setChapterBtn, setTestamentBtn, bookOrderNo } from "../State/globalSignals.js";

// Wait for the element to appear AND for its layout position to stabilize.
// Resolves with the element, or null if it never settled.
const waitForStableElement = (selector, { maxTries = 30, stableFrames = 2 } = {}) =>
  new Promise((resolve) => {
    let tries = 0;
    let lastTop = null;
    let stableCount = 0;

    const tick = () => {
      tries++;
      const el = document.querySelector(selector);

      if (el) {
        const top = el.getBoundingClientRect().top;
        // Element must report the SAME position for `stableFrames` consecutive
        // frames — this guarantees layout has finished settling.
        if (lastTop !== null && Math.abs(top - lastTop) < 0.5) {
          stableCount++;
          if (stableCount >= stableFrames) {
            resolve(el);
            return;
          }
        } else {
          stableCount = 0;
        }
        lastTop = top;
      }

      if (tries >= maxTries) {
        resolve(el || null); // give up — return whatever we have
        return;
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });

export const executeJumpTo = async (rawHit, onSuccess, pulse = true) => {
  // 1. Normalize the Data
  const rawTranslation = rawHit.translation_id || rawHit.translationId || rawHit.translation || rawHit.tr || "";
  const hit = {
    translation_id: rawTranslation.replace(/\.dba$/i, ""),
    book_id: rawHit.book_id || rawHit.bookId || rawHit.bk,
    chapter: parseInt(rawHit.chapter || rawHit.chapterNumber || rawHit.ch),
    verse_id: parseInt(rawHit.verse_id || rawHit.verseNumber || rawHit.verse || rawHit.vs || 1),
  };

  // 2. File Check
  const installed = await dbaExists(`${hit.translation_id}.dba`);
  if (!installed) {
    showToast(`Translation (${hit.translation_id}) Not Installed`, "error", 5000, true);
    return;
  }

  // 3. Commit signals atomically.
  //    Flip testament BEFORE the batch so the sidebar/nav updates in the same frame
  //    as the verse list — otherwise the OT→NT layout shift happens AFTER we scroll.
  if (typeof hit.book_id === "number" || !isNaN(parseInt(hit.book_id))) {
    const bookNum = parseInt(hit.book_id);
    if (!isNaN(bookNum)) {
      setTestamentBtn(bookNum <= 39 ? "ot" : "nt");
    }
  }

  batch(() => {
    setBible1(hit.translation_id);
    setBook(hit.book_id);
    setChapterNo(hit.chapter);
    setChapterBtn(hit.chapter);
    setTargetVerse(hit.verse_id);
  });

  updateAndLogScripture(hit);

  if (typeof onSuccess === "function") onSuccess();

  // 4. Wait for the new chapter to actually paint AND stop reflowing,
  //    THEN scroll. This is what fixes the OT→NT bug.
  const el = await waitForStableElement(".highlight-pulse");

  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Fallback: verify we actually landed near the target after the smooth
    // scroll completes. If we didn't (e.g. late-loading images shifted layout),
    // scroll once more instantly.
    setTimeout(() => {
      const check = document.querySelector(".highlight-pulse");
      if (!check) return;
      const rect = check.getBoundingClientRect();
      const vh = window.innerHeight;
      const outOfView = rect.top < vh * 0.15 || rect.bottom > vh * 0.85;
      if (outOfView) {
        check.scrollIntoView({ behavior: "auto", block: "center" });
      }
    }, 600);
  }

  // Clear target verse after the pulse animation finishes
  setTimeout(() => setTargetVerse(null), 2500);

  if (!pulse) setTargetVerse(null);
};
