import { createEffect, createResource, For, Show } from "solid-js";
import { activeCrossRef, activePaper, bible1 } from "../State/globalSignals.js";
import { invoke } from "@tauri-apps/api/core";
import { toggleSheet, currentSheet } from "../State/sheetStore";
import { executeJumpTo } from "../lib/navigationUtils";
import "./CSS/CrossRef.css";

export default function CrossRef(props) {
  createEffect(() => {
    if (currentSheet() === "crossref") {
      refetch();
    }
  });

  const [crossRefTexts] = createResource(
    () => {
      const current = activeCrossRef();
      if (!current || !current.refs || current.refs.length === 0) return false;

      const queries = current.refs.map((refStr) => {
        if (refStr.includes("-")) {
          // It's a range: "GEN.4.25-GEN.4.26"
          const [start, end] = refStr.split("-");
          const [book_id, chapter, startVerse] = start.split(".");
          const [_, __, endVerse] = end.split(".");

          return {
            ref_id: refStr,
            book_id,
            chapter: parseInt(chapter),
            start_verse: parseInt(startVerse),
            end_verse: parseInt(endVerse),
          };
        } else {
          // It's a single verse: "GEN.4.1"
          const [book_id, chapter, verse] = refStr.split(".");
          return {
            ref_id: refStr,
            book_id,
            chapter: parseInt(chapter),
            start_verse: parseInt(verse),
            end_verse: parseInt(verse),
          };
        }
      });

      return {
        translationFile: `${bible1()}.dba`,
        queries,
      };
    },
    async (source) => {
      const results = await invoke("get_cross_reference_texts", source);
      return results.reduce((acc, curr) => {
        acc[curr.reference_id] = curr.text;
        return acc;
      }, {});
    },
  );

  const getRefDetails = (refStr) => {
    if (!refStr) return { display: "", data: null };

    // 1. Parse the string
    const isRange = refStr.includes("-");
    const mainPart = isRange ? refStr.split("-")[0] : refStr;
    const [bookId, chapter, verse] = mainPart.split(".");

    // 2. Lookup the full book name from your props
    const bookEntry = props.books()?.find((b) => b.id === bookId);
    const bookName = bookEntry ? bookEntry.name : bookId;

    // 3. Format the Translation (e.g., "eng_kjv" -> "KJV")
    const transLabel = bible1()?.split("_")[1]?.toUpperCase() || "";

    // 4. Construct the Human-Readable Display
    let display = "";
    if (isRange) {
      const endVerse = refStr.split("-")[1].split(".")[2];
      display = `${bookName} ${chapter}:${verse}-${endVerse}`;
    } else {
      display = `${bookName} ${chapter}:${verse}`;
    }

    if (transLabel) display += ` (${transLabel})`;

    // 5. Construct the Navigation Data
    const navData = {
      translation_id: `${bible1()}.dba`,
      book_id: bookId,
      chapter: parseInt(chapter),
      verse_id: parseInt(verse),
    };

    return { display, navData };
  };

  const jumpTo = (hit) => {
    executeJumpTo(hit, () => {
      toggleSheet("crossref", "Min");
    });
  };

  return (
    <>
      {/* THE CROSS REFERENCE PANEL */}
      <Show when={activeCrossRef()}>
        <div class="cross-ref-panel scroll_Win">
          <center>Cross Reference</center>
          <br />
          <span class="cross-ref-header paper" classList={{ paperOverlay: activePaper() }}>
            {activeCrossRef().source}
          </span>

          <span></span>
          <div class="cross-ref-body">
            <For each={activeCrossRef()?.refs}>
              {(ref) => {
                const { display, navData } = getRefDetails(ref);
                return (
                  <div class="cross-ref-item" style="margin-bottom: 1rem;">
                    <span
                      onClick={() => {
                        jumpTo(navData);
                      }}
                      class="Entry-ref"
                    >
                      {display}
                    </span>
                    <p style="margin-top: 0.2rem;">
                      {crossRefTexts.loading ? "Loading text..." : crossRefTexts()?.[ref] || "Text not available."}
                    </p>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </>
  );
}
