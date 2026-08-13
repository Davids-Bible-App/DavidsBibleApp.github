// src/Components/TopicModal.jsx
import { createSignal, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { topicTarget, closeTopicModal, topicMetadata } from "../State/modalStore.js";
import { formatVerseRefs } from "../lib/bookmarkUtils.js";
import { triggerRefetch } from "../State/settingsStore.js";
import "./CSS/BookmarkModal.css";

const TAP_MOVE_THRESHOLD = 10; // px — anything beyond this is a scroll, not a tap
const TAP_TIME_THRESHOLD = 500; // ms — longer than this is a long-press, not a tap

const TopicModal = () => {
  const [topic, setTopic] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  // Tap-vs-scroll tracking
  let pointerStart = null; // { id, x, y, t }
  let suppressBlur = false; // prevents input blur from closing dropdown mid-tap/scroll

  const verses = () => topicTarget();
  const metadata = topicMetadata;

  // Reset when modal opens
  createEffect(() => {
    if (topicTarget()) {
      setTopic("");
      setError("");
    }
  });

  const exactMatch = () => {
    const t = topic().trim().toLowerCase();
    if (!t || !metadata()) return null;
    return metadata().find((m) => m.topic.toLowerCase() === t) ?? null;
  };

  // Suggestions for dropdown — similar but NOT exact (exact is already handled)
  const suggestions = () => {
    const t = topic().trim().toLowerCase();
    if (!metadata()) return [];
    if (!t) return metadata();
    return metadata().filter((m) => {
      const mt = m.topic.toLowerCase();
      return mt.includes(t) && mt !== t;
    });
  };

  const showDropdown = () => focused() && suggestions().length > 0;

  const pickSuggestion = (m) => {
    setTopic(m.topic);
    setError("");
    // Defer closing so the in-flight pointer/click sequence resolves against
    // the still-mounted dropdown, not the backdrop underneath.
    queueMicrotask(() => setFocused(false));
  };

  const handleSave = async () => {
    const t = topic().trim();
    if (!t) {
      setError("Please enter a topic.");
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
      const verseArgs = v.map((verse) => [`${verse.tr}.dba`, verse.bk, parseInt(verse.ch), parseInt(verse.vs)]);
      await invoke("save_verses_to_topic", { verses: verseArgs, topic: t });
      closeTopicModal();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? JSON.stringify(e));
      console.error("Topic save failed:", e);
      setError(msg);
    } finally {
      setSaving(false);
      triggerRefetch("refetchTopics", "refetchTopicVerses", "refetchTopicMetadata");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      if (showDropdown()) setFocused(false);
      else closeTopicModal();
    }
  };

  // ── Tap-vs-scroll handlers for a suggestion row ─────────────
  const onRowPointerDown = (e) => {
    pointerStart = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    };
    // Keep input focused/dropdown open through the whole gesture.
    suppressBlur = true;
  };

  const onRowPointerMove = (e) => {
    if (!pointerStart || e.pointerId !== pointerStart.id) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) {
      // User is scrolling — abandon the tap, but keep suppressBlur until
      // pointerup, so the input can't blur→close the dropdown mid-gesture.
      pointerStart = null;
    }
  };

  const onRowPointerUp = (m) => (e) => {
    const wasTap = pointerStart && e.pointerId === pointerStart.id && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) <= TAP_MOVE_THRESHOLD && performance.now() - pointerStart.t <= TAP_TIME_THRESHOLD;

    pointerStart = null;
    suppressBlur = false;

    if (wasTap) {
      e.preventDefault();
      pickSuggestion(m);
    }
  };

  const onRowPointerCancel = () => {
    pointerStart = null;
    suppressBlur = false;
  };

  // Guard the input blur so a tap/scroll on the dropdown doesn't close it prematurely
  const onInputBlur = () => {
    if (suppressBlur) return;
    // Defer slightly so pointerup on a row can complete first
    setTimeout(() => {
      if (!suppressBlur) setFocused(false);
    }, 0);
  };

  return (
    <Show when={verses()}>
      {/* Backdrop — close only on a real press on the backdrop itself,
          never as a downstream side effect of another element unmounting. */}
      <div
        class="BMModal-backdrop"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) closeTopicModal();
        }}
      />

      <div class="BMModal-dialog" role="dialog" aria-modal="true">
        <div class="BMModal-header">
          <span class="BMModal-icon">🏷️</span>
          <span class="BMModal-heading">{exactMatch() ? "Update Topic" : "Add Topic"}</span>
          <button class="BMModal-close" onClick={closeTopicModal} aria-label="Cancel">
            ✕
          </button>
        </div>

        <div class="BMModal-ref">{formatVerseRefs(verses())}</div>

        {/* Input + dropdown */}
        <div class="BMModal-input-wrap">
          <input
            class="BMModal-input"
            type="text"
            placeholder="Choose or Create Topic"
            maxLength={120}
            autofocus
            value={topic()}
            onInput={(e) => {
              setTopic(e.currentTarget.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={onInputBlur}
          />

          <Show when={showDropdown()}>
            <div class="BMModal-dropdown">
              <For each={suggestions()}>
                {(m) => (
                  <div
                    class="BMModal-suggestion"
                    onPointerDown={onRowPointerDown}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp(m)}
                    onPointerCancel={onRowPointerCancel}
                    onClick={(e) => {
                      // Swallow any synthetic click so it can't bubble to
                      // the backdrop or any ancestor listener.
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <span class="BMModal-suggestion-title">{m.topic}</span>
                    <span class="BMModal-suggestion-ref">
                      {m.count} verse{m.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Status pill — live feedback as you type */}
        <Show when={topic().trim()}>
          <div
            class="BMModal-status"
            classList={{
              "BMModal-status--overwrite": !!exactMatch(),
              "BMModal-status--new": !exactMatch(),
            }}
          >
            <Show when={exactMatch()} fallback={<span>✦ New topic will be created</span>}>
              <span>⚠ Verses will be added to this topic ({exactMatch()?.count} existing)</span>
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <p class="BMModal-error">{error()}</p>
        </Show>

        <div class="BMModal-actions">
          <button class="BMModal-btn BMModal-btn--cancel" onClick={closeTopicModal}>
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

export default TopicModal;
