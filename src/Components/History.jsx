import { createResource, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { toggleSheet, currentSheet } from "../State/sheetStore";
import { historyTrigger } from "../State/historyStore";
import { executeJumpTo } from "../lib/navigationUtils";
import "./CSS/History.css";

export default function History(props) {
  const fetchHistory = async () => {
    return await invoke("get_read_history");
  };

  // 1. Live Update: Re-runs fetchHistory automatically whenever historyTrigger changes
  const [history, { refetch }] = createResource(historyTrigger, fetchHistory);

  // 2. Fallback Update: Refetches just in case when the user opens the History sheet
  createEffect(() => {
    if (currentSheet() === "history") {
      refetch();
    }
  });

  const jumpTo = (hit) => {
    executeJumpTo(hit, () => {
      toggleSheet("history", "Hid");
    });
  };

  const handleDelete = async (e, entry) => {
    e.stopPropagation();
    try {
      await invoke("delete_history_entry", {
        translationId: entry.translation_id,
        bookId: entry.book_id,
        chapter: entry.chapter,
        verseId: entry.verse_id,
      });
      refetch();
    } catch (error) {
      console.error("Failed to delete history entry:", error);
    }
  };

  const handleClearAll = async () => {
    const confirmed = await ask("Are you sure you want to clear all reading history?", {
      title: "Clear History",
      kind: "warning",
    });

    if (!confirmed) return;

    try {
      await invoke("clear_all_history");
      refetch();
    } catch (error) {
      console.error("Failed to clear history:", error);
    }
  };

  const getFullBookName = (bookId) => {
    // Safety check in case props.books isn't loaded yet or is undefined
    if (!props.books() || !Array.isArray(props.books())) return bookId;

    // Find the matching book object
    const book = props.books().find((b) => b.id === bookId);

    // Return the english_name if found, otherwise fallback to the 3-letter ID
    return book ? book.english_name : bookId;
  };

  return (
    <div class="history-container">
      <div class="history-header">
        <span class="history-title">History</span>
        <div class="history-header-actions">
          <Show when={history()?.length > 0}>
            <button onClick={handleClearAll} class="history-btn history-clear-btn">
              Clear All
            </button>
          </Show>
        </div>
      </div>

      <Show when={history.loading}>
        <p>Loading history...</p>
      </Show>

      <ul class="history-list scroll_Win">
        <For each={history()}>
          {(entry) => (
            <li class="history-item" onClick={() => jumpTo(entry)}>
              <div class="history-item-content">
                <div class="history-item-ref">
                  {getFullBookName(entry.book_id)} {entry.chapter}:{entry.verse_id}
                </div>
                <div class="history-item-meta">
                  <span>{entry.translation_id}</span>
                  <span>{new Date(entry.updated_at * 1000).toLocaleDateString()}</span>
                </div>
              </div>

              <button class="history-item-delete" onClick={(e) => handleDelete(e, entry)} title="Remove from history">
                ✕
              </button>
            </li>
          )}
        </For>
      </ul>

      <Show when={history()?.length === 0}>
        <p class="history-empty">No reading history yet.</p>
      </Show>
    </div>
  );
}
