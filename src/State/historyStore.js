import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

const HISTORY_LIMIT = 50;

export const [currentScripture, setCurrentScripture] = createSignal({
  translation_id: "eng_kjv.dba",
  book_id: "GEN",
  chapter: 1,
  verse_id: 1,
});

// A signal that just increments to trigger refetches
export const [historyTrigger, setHistoryTrigger] = createSignal(0);

let historyTimer;

export const logHistoryEntry = (scripture) => {
  if (historyTimer) clearTimeout(historyTimer);

  historyTimer = setTimeout(async () => {
    try {
      await invoke("log_history_entry", {
        translationId: scripture.translation_id,
        bookId: scripture.book_id,
        chapter: scripture.chapter,
        verseId: scripture.verse_id,
        limit: HISTORY_LIMIT,
      });

      // Tell the app the database has new data!
      setHistoryTrigger((v) => v + 1);
    } catch (error) {
      console.error(error);
    }
  }, 1000);
};

export const updateAndLogScripture = (scripture) => {
  setCurrentScripture(scripture);
  logHistoryEntry(scripture);
};
