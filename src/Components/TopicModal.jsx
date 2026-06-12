// src/Components/TopicModal.jsx
import { createSignal, createEffect, createResource, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { topicTarget, closeTopicModal, topicMetadata, refetchTopicMetadata } from "../State/modalStore.js";
import { formatVerseRefs } from "../lib/bookmarkUtils.js";
import { triggerRefetch } from "../State/settingsStore.js";
import "./CSS/BookmarkModal.css";

const TopicModal = () => {
  const [topic, setTopic] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  const verses = () => topicTarget();
  const metadata = topicMetadata;

  // Reset when modal opens
  createEffect(() => {
    if (topicTarget()) {
      setTopic("");
      setError("");
    }
  });

  // FIX 2: both derived signals now operate on metadata(), not topicVerses()
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
    // Partial matches only; exact is already handled by the status pill
    return metadata().filter((m) => {
      const mt = m.topic.toLowerCase();
      return mt.includes(t) && mt !== t;
    });
  };

  const showDropdown = () => focused() && suggestions().length > 0;

  // FIX 3: receives the full metadata object, not a pre-extracted string
  const pickSuggestion = (m) => {
    setTopic(m.topic);
    setFocused(false);
    setError("");
    // No selectedId — the topic is now an exact match so exactMatch() handles it
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
      // FIX 4: restored the correct invoke matching the original component's signature
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

  return (
    <Show when={verses()}>
      <div class="BMModal-backdrop" onClick={closeTopicModal} />

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
            onBlur={() => setFocused(false)}
          />

          <Show when={showDropdown()}>
            <div class="BMModal-dropdown">
              {/* FIX 5: iterates suggestions() (filtered metadata), not raw metadata() */}
              <For each={suggestions()}>
                {(m) => (
                  <div
                    class="BMModal-suggestion"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      // FIX 3 (call site): passes the object, not m.topic
                      pickSuggestion(m);
                    }}
                  >
                    <span class="BMModal-suggestion-title">{m.topic}</span>
                    {/* FIX 6: metadata has .count, not .text JSON to parse */}
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
