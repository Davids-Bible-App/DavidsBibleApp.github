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
  const [searchHistory, setSearchHistory] = createSignal(JSON.parse(localStorage.getItem("strongsLookupHistory") || "[]"));
  const [showDropdown, setShowDropdown] = createSignal(false);

  let inputRef;

  // Keep track of the last injection to prevent the input from getting stuck
  let lastLookupSeq = null;

  // Listen for injected objects from StrongsVerse component
  createEffect(() => {
    const lookup = props.activeLookup();
    if (!lookup || lookup.seq === lastLookupSeq) return;

    lastLookupSeq = lookup.seq;
    setWasInjected(true);
    setSearchInput(lookup.query);
    setActiveSearch({ query: lookup.query, origin: lookup.origin });
    toggleSheet("strlook", "Max");
  });

  const [data] = createResource(activeSearch, fetchLookupData);

  const handleSearch = (e) => {
    // e.preventDefault();
    if (searchInput().trim()) {
      setActiveSearch({ query: searchInput().trim(), origin: null });
      setWasInjected(false);
      setShowDropdown(false);
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

  const jumpToStrongs = (code) => {
    setSearchInput(code);
    setActiveSearch({ query: code, origin: `"${activeSearch()?.query}" search results` });
    setWasInjected(false);
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

  const saveToHistory = (query) => {
    if (!query || query.trim().length === 0) return;

    setSearchHistory((prev) => {
      const filtered = prev.filter((item) => item !== query);
      const updated = [query, ...filtered].slice(0, 20);

      localStorage.setItem("strongsLookupHistory", JSON.stringify(updated));
      return updated;
    });
  };

  const removeFromHistory = (queryToRemove) => {
    setSearchHistory((prev) => {
      const updated = prev.filter((item) => item !== queryToRemove);
      localStorage.setItem("strongsLookupHistory", JSON.stringify(updated));
      return updated;
    });
  };

  createEffect(() => {
    const result = data();
    if (!result || data.loading) return;

    const hasResults = result.dictionaries?.length > 0 || result.verses?.length > 0;
    if (hasResults && activeSearch()?.query) {
      saveToHistory(activeSearch().query);
    }
  });
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSearch(0);
    }
  };
  return (
    <div class="StrongsLookup-Container paper" classList={{ paperOverlay: activePaper() }} style={`grid-template-rows: auto 15px 1fr`}>
      <center>Strongs Lookup</center>
      <br />

      <div class="StrongsLookup-Body">
        <div class="StrongsLookup-InputWrapper">
          <input ref={inputRef} type="text" placeholder="e.g. G746, H1254, or God" value={searchInput()} onInput={(e) => setSearchInput(e.target.value)} onKeyDown={handleKeyDown} onFocus={() => setShowDropdown(true)} onBlur={() => setShowDropdown(false)} class={`StrongsLookup-Input ${searchInput().length > 0 ? "has-buttons" : ""}`} />

          {searchInput().length > 0 && (
            <>
              <button class="StrongsLookup-ClearBtn" onClick={clearSearch}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708" />
                </svg>
              </button>
              <button class="StrongsLookup-GoBtn" onClick={() => handleSearch(0)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-return-left" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
                </svg>
              </button>
            </>
          )}
          <Show when={showDropdown() && searchHistory().length > 0}>
            <ul class="StrongsLookup-HistoryDropdown">
              <For each={searchHistory()}>
                {(item) => (
                  <li class="StrongsLookup-historyItem">
                    <span
                      class="StrongsLookup-historyText"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchInput(item);
                        setShowDropdown(false);
                        setActiveSearch({ query: item, origin: null });
                        setWasInjected(false);
                      }}
                    >
                      {item}
                    </span>
                    <button
                      class="StrongsLookup-historyDelete"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeFromHistory(item);
                      }}
                      aria-label="Remove from history"
                    >
                      ✕
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>

        <Show when={data.loading}>
          <div class="StrongsLookup-loading">Searching database...</div>
        </Show>

        <Show when={data() && !data.loading}>
          {/* Result count header */}
          <Show when={data().verseCount > 0}>
            <p class="StrongsLookup-result-count">
              "{activeSearch().query}" occurs <strong>{data().occurrenceCount}</strong> time{data().occurrenceCount !== 1 ? "s" : ""} in <strong>{data().verseCount}</strong> verse{data().verseCount !== 1 ? "s" : ""}.
            </p>
          </Show>
          <div class="StrongsLookup-list scroll_Win">
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
            <Show when={data().dictionaries && data().dictionaries.length > 0} fallback={<div class="StrongsLookup-loading">No dictionary definition found.</div>}>
              <div class="StrongsLookup-card" style="flex-direction: column;">
                <For each={data().dictionaries}>
                  {(dict) => (
                    <div class="StrongsLookup-dict-section" style="width: 100%; border-bottom: 1px solid var(--btn-border); padding-bottom: 1rem;">
                      <div class="StrongsLookup-dict-entry">
                        <div
                          class="StrongsLookup-strongs-tag"
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpToStrongs(dict.strongsId);
                          }}
                        >
                          {dict.strongsId}
                        </div>
                        <div class="StrongsLookup-original-header">
                          <span class="StrongsLookup-lemma" dir={dict.strongsId.startsWith("H") ? "rtl" : "ltr"}>
                            {dict.lemma}
                          </span>
                          <div class="StrongsLookup-phonetics">
                            <span class="StrongsLookup-transliteration">{dict.transliteration}</span>
                            <Show when={dict.pronunciation} fallback={<br />}>
                              <span class="StrongsLookup-pronunciation">[{dict.pronunciation}]</span>
                            </Show>
                          </div>
                        </div>

                        <div class="StrongsLookup-def-details">
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

            <Show when={data().verses && data().verses.length > 0} fallback={<div class="StrongsLookup-loading">No verses found containing this search.</div>}>
              <div class="StrongsLookup-verses-container">
                <For each={data().verses}>
                  {(verse) => (
                    <div class="StrongsLookup-verse-row">
                      <div class="StrongsLookup-verse-innerwrap">
                        <div onClick={() => jumpTo({ ...verse, translationId: bible1() })} class="StrongsLookup-verse-ref Entry-ref">
                          {verse.bookId} {verse.chapterNumber}:{verse.verseNumber}
                        </div>

                        {/* NEW: strongs code tags for this specific occurrence */}
                        <Show when={verse.strongsIds && verse.strongsIds.length > 0}>
                          <div class="StrongsLookup-verse-codes">
                            <For each={verse.strongsIds}>
                              {(code) => (
                                <span
                                  class="StrongsLookup-code-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    jumpToStrongs(code);
                                  }}
                                >
                                  {code}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
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
