import { createSignal, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { abbreviator, getBook } from "../lib/functions.js";
import { toggleSheet, currentSheet, setSheetStep } from "../State/sheetStore";
import { onSheetClose, activeSheet, getBaseStep } from "../State/sheetStore";

import { executeJumpTo } from "../lib/navigationUtils";
import "./CSS/SearchRef.css";
import { bible1, setTrigger, setTopicController, setSelectedTopic, setSelection, wordHighlight, setWordHighlight } from "../State/globalSignals.js";
import { setPendingVerses } from "../State/editorStore";

export default function SearchRef(props) {
  const [searchResults, setSearchResults] = createSignal([]);
  const [isReference, setIsReference] = createSignal(false);
  const [searchInput, setSearchInput] = createSignal("");
  const [searchScope, setSearchScope] = createSignal("");
  const [searchTarget, setSearchTarget] = createSignal(["eng_kjv.dba"]);
  const [page, setPage] = createSignal(0);
  const [perPage, setPerPage] = createSignal(5);
  const [isEditingPage, setIsEditingPage] = createSignal(false);
  const [pageInput, setPageInput] = createSignal("");
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal(0);
  const [searchHistory, setSearchHistory] = createSignal(JSON.parse(localStorage.getItem("bibleSearchHistory") || "[]"));
  const [showDropdown, setShowDropdown] = createSignal(false);
  const [selectedVerses, setSelectedVerses] = createSignal([]);

  let searchInputRef;
  let startX = 0;
  let startY = 0;
  let isSwipe = false;
  const totalPages = () => Math.ceil((searchResults()?.total_count || 0) / perPage());

  createEffect(() => {
    if (activeSheet() === "search" && getBaseStep() === "Mid") {
      setTimeout(() => {
        searchInputRef?.focus();
        searchInputRef?.select();
      }, 150);
    }
  });

  const handlePointerDown = (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isSwipe = false;
    setIsDragging(true);
    setDragOffset(0);
    // e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging()) return;

    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
      isSwipe = true;
    }
    setDragOffset(e.clientX - startX);
  };

  const handlePointerUp = (e) => {
    if (!isDragging()) return;
    setIsDragging(false);

    const threshold = 50;

    // Right swipe (Go to Previous Page)
    if (dragOffset() > threshold) {
      if (page() > 0) handleSearch(page() - 1);
    }
    // Left swipe (Go to Next Page)
    else if (dragOffset() < -threshold) {
      if (page() < totalPages() - 1) handleSearch(page() + 1);
    }
    isSwipe = false;
    setDragOffset(0);
    // e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handlePointerCancel = (e) => {
    setIsDragging(false);
    isSwipe = false;
    setDragOffset(0);
    // e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const startEditingPage = () => {
    setPageInput((page() + 1).toString());
    setIsEditingPage(true);
  };

  const handlePageInput = (e) => {
    // Strip out anything that isn't a number
    const val = e.target.value.replace(/[^0-9]/g, "");
    setPageInput(val);
  };

  const submitPageChange = () => {
    let newPage = parseInt(pageInput(), 10);
    const maxPages = totalPages();

    if (!isNaN(newPage) && newPage > 0) {
      // Clamp the number to ensure it doesn't exceed max pages
      if (newPage > maxPages) newPage = maxPages;

      // Only search if the page actually changed
      if (newPage - 1 !== page()) {
        handleSearch(newPage - 1); // 0-indexed
      }
    }
    setIsEditingPage(false);
  };

  const handlePageKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Prevents your main search input from triggering
      submitPageChange();
    } else if (e.key === "Escape") {
      setIsEditingPage(false); // Cancel edit on escape
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSearch(0);
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchResults([]);
    setIsReference(false);
    setSelectedVerses([]);
    if (searchInputRef) searchInputRef.focus();
    toggleSheet("search", "Mid");
  };

  const saveToHistory = (query) => {
    if (!query || query.trim().length === 0) return;

    setSearchHistory((prev) => {
      // Remove the query if it already exists so we can move it to the top
      const filtered = prev.filter((item) => item !== query);
      // Add to front, keep only the first 20
      const updated = [query, ...filtered].slice(0, 20);

      localStorage.setItem("bibleSearchHistory", JSON.stringify(updated));
      return updated;
    });
  };

  const removeFromHistory = (queryToRemove) => {
    setSearchHistory((prev) => {
      const updated = prev.filter((item) => item !== queryToRemove);
      localStorage.setItem("bibleSearchHistory", JSON.stringify(updated));
      return updated;
    });
  };

  const handleSearch = async (pageNum = 0) => {
    const val = searchInput().trim();
    if (val.length === 0) return;

    const currentTrans = bible1() + ".dba";
    setSearchTarget([currentTrans]);

    // Hide dropdown when a search fires
    setShowDropdown(false);
    setIsReference(false);

    const res = await invoke("unified_search", {
      query: val,
      targets: searchTarget(),
      scope: searchScope(),
      page: pageNum,
      perPage: perPage(),
      highlightOn: true,
    });

    // Handle the two different result types
    if (res.type === "Reference") {
      setIsReference(true);
      // console.log("Referenced Verses!", res.data); // Array of VerseEntry
      setSearchResults({ hits: res.data, total_count: res.data.length });
    } else {
      setIsReference(false);
      // console.log("Highlighted Search Words:", res.data.hits); // SearchResponse
      setSearchResults(res.data);
      setPage(pageNum);
    }

    searchResults().total_count > 0 && saveToHistory(val);

    if (res.data) {
      currentSheet("search") === "Min" && setSheetStep("Mid");
      searchInputRef?.blur();
    }
  };

  const toggleVerseSelection = (hit, e) => {
    e.stopPropagation();

    // Create our unique ID for comparison
    const verseId = `${hit.book_id}-${hit.chapter}-${hit.verse}`;

    setSelectedVerses((prev) => {
      // Check if the verse is already in our array
      const exists = prev.some((v) => `${v.book_id}-${v.chapter}-${v.verse}` === verseId);

      if (exists) {
        // It's already selected, so remove it
        return prev.filter((v) => `${v.book_id}-${v.chapter}-${v.verse}` !== verseId);
      } else {
        // It's new, so add the entire 'hit' object to the array
        return [...prev, hit];
      }
    });
  };

  const sendToEditor = () => {
    // We already have the full verse objects stored!
    const versesToExport = selectedVerses();

    if (versesToExport.length === 0) return;

    // Send data to the global queue (from Phase 2)
    setPendingVerses(versesToExport);
    // console.log("Sending to editor:", versesToExport);

    // Clear local selection after sending
    setSelectedVerses([]);

    toggleSheet("editor", "Max");
  };

  const sendToTopic = () => {
    if (selectedVerses().length === 0) return;

    const selectedObj = [];
    selectedVerses().forEach((v) => {
      selectedObj.push({
        ed: abbreviator(v.translation),
        tr: v.translation.replace(/\.dba$/i, ""),
        bk: v.book_id,
        ch: v.chapter,
        vs: v.verse,
        tx: v.text,
      });
    });

    // console.log("Sending to topic:", selectedObj);

    setSelection(selectedObj);
    setSelectedTopic(null);
    toggleSheet("search", "Hid");
    setTrigger("right");
    setTopicController(true);

    // Clear local selection after sending
    setSelectedVerses([]);
  };

  const jumpTo = (hit) => {
    executeJumpTo(hit, () => {
      toggleSheet("search", "Min");
    });
  };

  return (
    <div
      class="SearchRef-Container"
      /* Conditional Paging */
      style={`grid-template-rows: auto 45px 1fr ${!isReference() && searchResults()?.total_count > 5 ? "55px" : "0"};`}
    >
      {/* Radio Buttons Section */}
      <div class="SearchRef-Controls">
        {/* Set 1: Search Scope */}
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>Scope:</span>
          <div class="SearchRef-RadioGroup">
            <For each={["OT", "NT"]}>
              {(option) => (
                <button
                  onClick={() => {
                    setSearchScope(searchScope() === option ? "" : option);
                  }}
                  style={`
                    background: ${searchScope() === option ? "var(--ThemeCtrl3)" : "transparent"};
                    color: ${searchScope() === option ? "var(--text-color)" : "var(--text-color-tone)"};
                  `}
                >
                  {option}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Set 2: Word Highlight */}
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>Highlight:</span>
          <div class="SearchRef-RadioGroup">
            <button
              onClick={() => setWordHighlight(true)}
              style={`
                background: ${wordHighlight() ? "var(--ThemeCtrl3)" : "transparent"};
                color: ${wordHighlight() ? "var(--text-color)" : "var(--text-color-tone)"};`}
            >
              On
            </button>
            <button
              onClick={() => setWordHighlight(false)}
              style={`
                background: ${!wordHighlight() ? "var(--ThemeCtrl3)" : "transparent"};
                color: ${!wordHighlight() ? "var(--text-color)" : "var(--text-color-tone)"};`}
            >
              Off
            </button>
          </div>
        </div>
      </div>
      <div class="SearchRef-InputWrapper">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="e.g. John1:1-4, jhn.1:1,3,4,2, jn2-4,5:2,1:1"
          value={searchInput()}
          onInput={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setShowDropdown(true);
            currentSheet("search") === "Min" && toggleSheet("search", "Mid");
          }}
          onBlur={() => setShowDropdown(false)}
          class={`SearchRef-Input ${searchInput().length > 0 ? "has-buttons" : ""}`}
        />

        {searchInput().length > 0 && (
          <>
            <button class="SearchRef-ClearBtn" onClick={clearSearch}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708" />
              </svg>
            </button>
            <button class="SearchRef-GoBtn" onClick={() => handleSearch(0)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-return-left" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
              </svg>
            </button>
          </>
        )}
        <Show
          when={searchResults()?.total_count > 0}
          fallback={
            searchResults()?.total_count == 0 && (
              <center>
                <small>"Sorry no results found"</small>
              </center>
            )
          }
        >
          <center>
            <small>Total Results: | {searchResults()?.total_count} |</small>
            <Show when={selectedVerses().length > 0}>
              <div class="SearchRef-FloatingActionBar">
                <small>Send {selectedVerses().length} Verses to </small>
                <button onClick={sendToEditor}>Editor</button>
                &nbsp;<small> or </small>&nbsp;
                <button onClick={sendToTopic}>Topic</button>
              </div>
            </Show>
          </center>
        </Show>
        <Show when={showDropdown() && searchHistory().length > 0}>
          <ul class="SearchRef-HistoryDropdown">
            <For each={searchHistory()}>
              {(item) => (
                <li class="SearchRef-historyItem">
                  {/* The clickable search term */}
                  <span
                    class="SearchRef-historyText"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSearchInput(item);
                      setShowDropdown(false);
                      handleSearch(0);
                    }}
                  >
                    {item}
                  </span>

                  {/* The delete button */}
                  <button
                    class="SearchRef-historyDelete"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation(); // Stops the click from bubbling up and triggering a search
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

      <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} class="SearchRef-Results scroll_Win" style={{ "touch-action": "pan-y" }}>
        <For each={searchResults().hits}>
          {(hit) => {
            const verseId = `${hit.book_id}-${hit.chapter}-${hit.verse}`;
            const isSelected = () => selectedVerses().some((v) => `${v.book_id}-${v.chapter}-${v.verse}` === verseId);

            return (
              <>
                <div
                  class={`SearchRef-ResultItem ${isSelected() ? "SearchRef-selected-verse" : ""}`}
                  onClick={(e) => {
                    if (isSwipe) return;
                    toggleVerseSelection(hit, e);
                  }}
                >
                  <header
                    class="Entry-ref"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSwipe) return;
                      jumpTo(hit);
                    }}
                  >
                    {getBook(hit.book_id)} {hit.chapter}:{hit.verse} ({abbreviator(hit?.translation)})
                  </header>
                  <p class="verse-text" innerHTML={hit.text} />
                </div>
                <Show when={wordHighlight()}>
                  <style jsx>{`
                    mark {
                      color: var(--text-color-inverted);
                      background: var(--verseNo);
                      border-radius: 5px;
                      padding: 0 5px;
                    }
                  `}</style>
                </Show>
              </>
            );
          }}
        </For>
      </div>
      <div class="SearchRef-paging">
        <Show when={!isReference() && searchResults()?.total_count > 5}>
          <div class="pagination-controls">
            <button disabled={page() === 0} onClick={() => handleSearch(page() - 1)}>
              Prev
            </button>
            <span>
              <Show
                when={isEditingPage()}
                fallback={
                  <code onClick={startEditingPage} style="cursor: pointer; user-select: none;" title="Click to jump to page">
                    [ Page {page() + 1} of {totalPages()} ]
                  </code>
                }
              >
                <code>
                  [ Page
                  <input
                    type="text"
                    inputmode="numeric"
                    value={pageInput()}
                    onInput={handlePageInput}
                    onKeyDown={handlePageKeyDown}
                    onBlur={submitPageChange}
                    ref={(el) => {
                      setTimeout(() => {
                        el.focus();
                        el.select();
                      }, 10);
                    }}
                    style="width: 40px; text-align: center; background: transparent; color: inherit; border: 1px solid var(--ThemeAccent1); border-radius: 4px; outline: none;font-variant-numeric: tabular-nums;"
                  />
                  of {totalPages()} ]
                </code>
              </Show>
            </span>
            <button disabled={searchResults().hits?.length < perPage()} onClick={() => handleSearch(page() + 1)}>
              Next
            </button>
            <select
              value={perPage()}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                handleSearch(0);
              }}
            >
              <option value="5">5 per page</option>
              <option value="25">25 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
              <option value="200">200 per page</option>
              <option value="2000">2000 per page</option>
            </select>
          </div>
        </Show>
      </div>
    </div>
  );
}
