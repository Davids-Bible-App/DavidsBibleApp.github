import { createResource, createMemo, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { activePaper, selection } from "../State/globalSignals.js";
import "./CSS/StrongsVerse.css";

const fetchStudyData = async ([bookId, chapter, verse]) => {
  const rows = await invoke("get_verse_study", { bookId, chapter, verse });

  const groupedWords = [];
  let currentWord = null;

  for (const row of rows) {
    if (!/[a-zA-Z]/.test(row.englishWord)) continue;

    if (!currentWord || currentWord.wordOrder !== row.wordOrder) {
      if (currentWord) groupedWords.push(currentWord);
      currentWord = {
        wordOrder: row.wordOrder,
        englishWord: row.englishWord,
        isAdded: row.isAdded === 1,
        rawStrongs: row.rawStrongs,
        definitions: [],
      };
    }

    if (row.strongsId) {
      currentWord.definitions.push({
        strongsId: row.strongsId,
        lemma: row.lemma,
        transliteration: row.transliteration,
        pronunciation: row.pronunciation,
        kjvDef: row.kjvDef,
        definition: row.definition,
      });
    }
  }
  if (currentWord) groupedWords.push(currentWord);

  return groupedWords;
};

export default function StrongsVerse(props) {
  // 1. The Latch: Capture and hold the last valid selection
  const lastValidSelection = createMemo(
    (prev) => {
      const current = selection()[0];

      // If the selection has data (e.g., the object isn't empty), return the new data.
      if (current && Object.keys(current).length > 0) {
        return current;
      }

      // If the selection was cleared out, return the PREVIOUS saved data.
      return prev;
    },
    { bk: "GEN", ch: 1, vs: 1 },
  ); // <-- The second argument is the initial starting state

  // 2. The Formatter: Derive your final UI state based on the latched data
  const ref = createMemo(
    (prev) => {
      // Read from your new latched memo, NOT directly from selection() anymore
      const selected = lastValidSelection();

      const bkId = selected.bk || "GEN";
      let displayName = bkId;

      // Track the resource unconditionally
      const booksList = props.books ? props.books.latest : undefined;

      if (booksList) {
        const match = booksList.find((b) => b.id === bkId);
        if (match?.english_name) {
          displayName = match.english_name;
        }
      }

      return {
        bk: bkId,
        bookName: displayName,
        ch: parseInt(selected.ch) || 1,
        vs: parseInt(selected.vs) || 1,
      };
    },
    undefined,
    {
      // Keep your equality check to prevent unnecessary re-renders
      equals: (prev, next) => prev && prev.bk === next.bk && prev.bookName === next.bookName && prev.ch === next.ch && prev.vs === next.vs,
    },
  );

  const [words] = createResource(() => {
    const { bk, ch, vs } = ref();
    // Sanitize the ID (removes spaces like "1 TH" -> "1TH" and forces uppercase)
    const cleanBk = bk.replace(/\s+/g, "").toUpperCase();
    return [cleanBk, ch, vs];
  }, fetchStudyData);

  return (
    <div class="StrongsVerse-container scroll_Win">
      <center>Strongs Dictionary</center>
      <br />

      <div class="StrongsVerse-header paper" classList={{ paperOverlay: activePaper() }}>
        <span>
          {ref().bookName} {ref().ch}:{ref().vs} (KJV)
        </span>
      </div>

      <Show when={words.loading}>
        <div class="StrongsVerse-loading">Loading original texts...</div>
      </Show>

      <div class="StrongsVerse-list">
        <For each={words()}>
          {(word) => (
            <div class="StrongsVerse-card">
              <div class="StrongsVerse-english-section">
                <span class={word.isAdded ? "StrongsVerse-word-added" : "StrongsVerse-word-base"}>{word.englishWord}</span>
                <Show when={word.isAdded}>
                  <span class="StrongsVerse-added-label">Was added for language flow.</span>
                </Show>
              </div>

              <div class="StrongsVerse-dict-section">
                <Show when={word.definitions.length > 0} fallback={null}>
                  <For each={word.definitions}>
                    {(def) => (
                      <div class="StrongsVerse-dict-entry">
                        <button onClick={() => props.setActiveLookup({ query: def.strongsId, origin: word.englishWord })} class="StrongsVerse-strongs-tag">
                          {def.strongsId}
                        </button>

                        <div class="StrongsVerse-original-header">
                          <span class="StrongsVerse-lemma" dir={def.strongsId.startsWith("H") ? "rtl" : "ltr"}>
                            {def.lemma}
                          </span>
                          <div class="StrongsVerse-phonetics">
                            <span class="StrongsVerse-transliteration">{def.transliteration}</span>
                            <Show when={def.pronunciation && def.pronunciation.trim() !== ""} fallback={<br />}>
                              <span class="StrongsVerse-pronunciation">[{def.pronunciation}]</span>
                            </Show>
                          </div>
                        </div>

                        <div class="StrongsVerse-def-details">
                          <p>
                            <strong>Usage:</strong> {def.kjvDef}
                          </p>
                          <p>
                            <strong>Definition:</strong> {def.definition}
                          </p>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
