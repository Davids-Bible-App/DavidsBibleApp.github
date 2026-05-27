// src/Components/BookmarkModal.jsx
import { createSignal, createEffect, createResource, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { bookmarkTarget, closeBookmarkModal, bms as existing } from "../State/modalStore.js";
import { formatVerseRefs } from "../lib/bookmarkUtils.js";
import { triggerRefetch } from "../State/settingsStore.js";
import "./CSS/BookmarkModal.css";

const BookmarkModal = () => {
  const [title, setTitle] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  const verses = () => bookmarkTarget();

  // Reset when modal opens
  createEffect(() => {
    if (bookmarkTarget()) {
      setTitle("");
      setError("");
    }
  });

  // Exact match (case-insensitive) → will overwrite on save
  const exactMatch = () => {
    const t = title().trim().toLowerCase();
    if (!t) return null;
    return (existing() ?? []).find((bm) => bm.title.toLowerCase() === t) ?? null;
  };

  // Suggestions for dropdown — similar but NOT exact (exact is already handled)
  const suggestions = () => {
    const t = title().trim().toLowerCase();
    const all = existing() ?? [];
    if (!t) return all;
    // Show partial matches; exclude the exact match since status pill covers that
    return all.filter((bm) => {
      const bmt = bm.title.toLowerCase();
      return bmt.includes(t) && bmt !== t;
    });
  };

  const showDropdown = () => focused() && suggestions().length > 0 && !exactMatch();

  // ── Autocomplete pick — fills input only, no lock-in ───────────────────────
  const pickSuggestion = (bm) => {
    setTitle(bm.title);
    setFocused(false);
    setError("");
    // No selectedId — the title is now an exact match so exactMatch() handles it
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const t = title().trim();
    if (!t) {
      setError("Please enter a title.");
      return;
    }

    const v = verses();
    if (!v?.length) {
      setError("No verses selected.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const match = exactMatch();
      if (match) {
        // Exact title exists → overwrite verses only, title unchanged
        await invoke("overwrite_bookmark", {
          id: match.id,
          verses: JSON.stringify(v),
        });
      } else {
        await invoke("add_bookmark", {
          title: t,
          verses: JSON.stringify(v),
        });
      }
      // bumpBookmarkVersion();
      closeBookmarkModal();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? JSON.stringify(e));
      console.error("bookmark save failed:", e);
      setError(msg);
    } finally {
      setSaving(false);
      triggerRefetch("refetchBookmarks");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      if (showDropdown()) setFocused(false);
      else closeBookmarkModal();
    }
  };

  return (
    <Show when={verses()}>
      <div class="BMModal-backdrop" onClick={closeBookmarkModal} />

      <div class="BMModal-dialog" role="dialog" aria-modal="true">
        <div class="BMModal-header">
          <span class="BMModal-icon">🔖</span>
          <span class="BMModal-heading">{exactMatch() ? "Update Bookmark" : "Add Bookmark"}</span>
          <button class="BMModal-close" onClick={closeBookmarkModal} aria-label="Cancel">
            ✕
          </button>
        </div>

        <div class="BMModal-ref">{formatVerseRefs(verses())}</div>

        {/* Input + dropdown */}
        <div class="BMModal-input-wrap">
          <input
            class="BMModal-input"
            type="text"
            placeholder="Title / Reason…"
            maxLength={120}
            autofocus
            value={title()}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />

          <Show when={showDropdown()}>
            <div class="BMModal-dropdown">
              <For each={suggestions()}>
                {(bm) => (
                  <div
                    class="BMModal-suggestion"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      pickSuggestion(bm);
                    }}
                  >
                    <span class="BMModal-suggestion-title">{bm.title}</span>
                    <span class="BMModal-suggestion-ref">
                      {(() => {
                        try {
                          const vv = JSON.parse(bm.verses);
                          return `${vv[0]?.bk} ${vv[0]?.ch}:${vv[0]?.vs}`;
                        } catch {
                          return "";
                        }
                      })()}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Status pill — live feedback as you type */}
        <Show when={title().trim()}>
          <div
            class="BMModal-status"
            classList={{
              "BMModal-status--overwrite": !!exactMatch(),
              "BMModal-status--new": !exactMatch(),
            }}
          >
            <Show when={exactMatch()} fallback={<span>✦ New bookmark will be created</span>}>
              <span>⚠ Verses will be updated on this bookmark</span>
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <p class="BMModal-error">{error()}</p>
        </Show>

        <div class="BMModal-actions">
          <button class="BMModal-btn BMModal-btn--cancel" onClick={closeBookmarkModal}>
            Cancel
          </button>
          <button class="BMModal-btn BMModal-btn--save" classList={{ "BMModal-btn--overwrite": !!exactMatch() }} disabled={saving()} onClick={handleSave}>
            {saving() ? "Saving…" : exactMatch() ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </Show>
  );
};

export default BookmarkModal;
