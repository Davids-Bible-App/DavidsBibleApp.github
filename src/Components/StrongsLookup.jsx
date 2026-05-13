import { createSignal, createResource, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { toggleSheet, onSheetClose, activeSheet, getBaseStep } from "../State/sheetStore";
import { activePaper, bible1 } from "../State/globalSignals.js";
import { executeJumpTo } from "../lib/navigationUtils";
import "./CSS/StrongsLookup.css";

const fetchLookupData = async (searchObj) => {
  if (!searchObj || !searchObj.query || searchObj.query.trim() === "") return null;
  return await invoke("lookup_strongs", { query: searchObj.query });
};

export default function StrongsLookup(props) {
  const [searchInput, setSearchInput] = createSignal("");
  const [activeSearch, setActiveSearch] = createSignal(null);
  const [wasInjected, setWasInjected] = createSignal(false);

  let inputRef;

  // Keep track of the last injection to prevent the input from getting stuck
  let lastInjectedQuery = "";

  // Listen for injected objects from StrongsVerse component
  createEffect(() => {
    const injected = props.activeLookup();
    if (injected && injected.query !== lastInjectedQuery) {
      setWasInjected(true);
      lastInjectedQuery = injected.query;
      setSearchInput(injected.query);
      setActiveSearch({ query: injected.query, origin: injected.origin });

      toggleSheet("strlook", "Max");
    }
  });

  const [data] = createResource(activeSearch, fetchLookupData);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchInput().trim()) {
      // Manual searches clear the "origin" since it's a fresh search
      setActiveSearch({ query: searchInput().trim(), origin: null });
      setWasInjected(false);
      inputRef.blur();
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    setActiveSearch({ query: null, origin: null });
    inputRef.focus();
  };

  const jumpTo = (hit) => {
    executeJumpTo(hit, () => {
      toggleSheet("strlook", "Min:120px");
    });
  };

  onSheetClose("strlook", () => {
    if (wasInjected()) {
      toggleSheet("strongs", "Mid");
      setWasInjected(false);
      props.setActiveLookup(null);
      setActiveSearch({ query: searchInput().trim(), origin: null });
    }
    inputRef.blur();
  });

  createEffect(() => {
    if (activeSheet() === "strlook" && getBaseStep() !== "Min" && !wasInjected()) {
      setTimeout(() => {
        inputRef?.focus();
        inputRef?.select();
      }, 150);
    }
  });
  return (
    <div class="StrongsVerse-container scroll_Win">
      <center>Strongs Lookup</center>
      <br />

      <div class="StrongsLookup-body">
        <div
          class="StrongsVerse-header paper"
          style="flex-direction: column; align-items: center; gap: 0.5rem;"
          classList={{ paperOverlay: activePaper() }}
        >
          <form onSubmit={handleSearch} class="StrongsLookup-search-form">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. G746, H1254, or God"
              value={searchInput()}
              onInput={(e) => setSearchInput(e.target.value)}
              class="StrongsLookup-input"
            />

            <button type="submit" class="StrongsLookup-btn">
              Search
            </button>
          </form>
          {searchInput().length > 0 && (
            <button class="StrongsLookup-ClearBtn" onClick={clearSearch}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="currentColor"
                class="bi bi-x"
                viewBox="0 0 16 16"
              >
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708" />
              </svg>
            </button>
          )}
        </div>

        <Show when={data.loading}>
          <div class="StrongsVerse-loading">Searching database...</div>
        </Show>

        <Show when={data() && !data.loading}>
          <div class="StrongsVerse-list">
            <div class="StrongsLookup-section-title">
              {data().searchType === "strongs" ? "STRONGS DEFINITION LOOKUP" : "ENGLISH WORD MATCHES"}
              <Show when={activeSearch()?.origin}>
                <p class="StrongsLookup-subtitle" style="text-transform: none;">
                  (Originating from: <strong>{activeSearch().origin}</strong>)
                </p>
              </Show>
              <hr class="StrongsLookup-hr" />
            </div>

            {/* Dictionary Definitions Section (Now iterates over multiple) */}
            <Show
              when={data().dictionaries && data().dictionaries.length > 0}
              fallback={<div class="StrongsVerse-loading">No dictionary definition found.</div>}
            >
              <div class="StrongsVerse-card" style="flex-direction: column;">
                <For each={data().dictionaries}>
                  {(dict) => (
                    <div
                      class="StrongsVerse-dict-section"
                      style="width: 100%; border-bottom: 1px solid var(--btn-border); padding-bottom: 1rem;"
                    >
                      <div class="StrongsVerse-dict-entry">
                        <div class="StrongsVerse-strongs-tag">{dict.strongsId}</div>

                        <div class="StrongsVerse-original-header">
                          <span class="StrongsVerse-lemma" dir={dict.strongsId.startsWith("H") ? "rtl" : "ltr"}>
                            {dict.lemma}
                          </span>
                          <div class="StrongsVerse-phonetics">
                            <span class="StrongsVerse-transliteration">{dict.transliteration}</span>
                            <Show when={dict.pronunciation} fallback={<br />}>
                              <span class="StrongsVerse-pronunciation">[{dict.pronunciation}]</span>
                            </Show>
                          </div>
                        </div>

                        <div class="StrongsVerse-def-details">
                          <p>
                            <strong>Usage:</strong> {dict.kjvDef}
                          </p>
                          <p>
                            <strong>Definition:</strong> {dict.definition}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Verse Usage Section */}
            <div class="StrongsLookup-section-title" style="margin-top: 2rem;">
              USES OF : {activeSearch().query.toUpperCase()}
              <hr class="StrongsLookup-hr" />
            </div>

            <Show
              when={data().verses && data().verses.length > 0}
              fallback={<div class="StrongsVerse-loading">No verses found containing this search.</div>}
            >
              <div class="StrongsLookup-verses-container">
                <For each={data().verses}>
                  {(verse) => (
                    <div class="StrongsLookup-verse-row">
                      <div
                        onClick={() => {
                          jumpTo({ ...verse, translationId: bible1() });
                        }}
                        class="StrongsLookup-verse-ref Entry-ref"
                      >
                        {verse.bookId} {verse.chapterNumber}:{verse.verseNumber}
                      </div>
                      <div class="StrongsLookup-verse-text">{verse.text}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
