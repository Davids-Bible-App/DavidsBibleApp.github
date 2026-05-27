// src/Components/Bookmark.jsx
import { createSignal, createEffect, createResource, For, Show, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { formatVerseRefs, parseVerses, executeBookmarkJumpTo } from "../lib/bookmarkUtils.js";
import { triggerRefetch } from "../State/settingsStore.js";

import { bms } from "../State/modalStore.js";
import { setTrigger } from "../State/globalSignals.js";
import { type } from "@tauri-apps/plugin-os";
import "./CSS/Bookmark.css";

const Bookmark = (props) => {
  const [order, setOrder] = createSignal([]);
  const [editId, setEditId] = createSignal(null);
  const [editTitle, setEditTitle] = createSignal("");

  createEffect(() => {
    const data = bms();
    if (data?.length) setOrder(data.map((b) => b.id));
  });

  const sorted = () => {
    const data = bms();
    const ord = order();
    if (!data) return [];
    const map = new Map(data.map((b) => [b.id, b]));
    return ord.length ? ord.map((id) => map.get(id)).filter(Boolean) : data;
  };

  const filtered = () => {
    const q = props.searchText?.()?.trim().toLowerCase();
    if (!q) return sorted();
    return sorted().filter((bm) => bm.title.toLowerCase().includes(q));
  };

  // ── Drag ──────────────────────────────────────────────────────────────────
  const itemRefs = new Map();
  let snapRects = new Map();
  let ghostEl = null;
  let dragId = null;
  let startY = 0;
  let insertIdx = 0;

  const onDragStart = (e, id) => {
    e.preventDefault();
    dragId = id;
    startY = e.clientY;

    snapRects = new Map();
    for (const [bmId, el] of itemRefs) {
      const r = el.getBoundingClientRect();
      snapRects.set(bmId, { top: r.top, left: r.left, width: r.width, height: r.height });
    }
    insertIdx = order().indexOf(id);

    const srcEl = itemRefs.get(id);
    const snap = snapRects.get(id);
    const computed = window.getComputedStyle(srcEl);

    ghostEl = srcEl.cloneNode(true);
    Object.assign(ghostEl.style, {
      position: "fixed",
      top: snap.top + "px",
      left: snap.left + "px",
      width: snap.width + "px",
      height: snap.height + "px",
      margin: "0",
      zIndex: "9999",
      pointerEvents: "none",
      background: computed.background,
      backgroundColor: computed.backgroundColor,
      borderRadius: computed.borderRadius,
      boxShadow: "0 14px 36px rgba(0,0,0,0.38), 0 4px 12px rgba(0,0,0,0.24)",
      opacity: "0.97",
      transform: "scale(1.03)",
      transformOrigin: "center center",
      overflow: "hidden",
    });
    document.body.appendChild(ghostEl);
    srcEl.style.visibility = "hidden";

    window.addEventListener("pointermove", onDragMove, { passive: false });
    window.addEventListener("pointerup", onDragEnd);
  };

  const onDragMove = (e) => {
    if (!dragId) return;
    e.preventDefault();

    ghostEl.style.transform = `scale(1.03) translateY(${e.clientY - startY}px)`;

    const ord = order();
    const fromIdx = ord.indexOf(dragId);
    const dragSnap = snapRects.get(dragId);

    const above = ord
      .filter((id) => id !== dragId)
      .filter((id) => {
        const r = snapRects.get(id);
        return r && r.top + r.height / 2 < e.clientY;
      }).length;

    const toIdx = Math.max(0, Math.min(above, ord.length - 1));
    insertIdx = toIdx;

    for (const [id, el] of itemRefs) {
      if (id === dragId) continue;
      const elIdx = ord.indexOf(id);
      let shift = 0;
      if (fromIdx < toIdx && elIdx > fromIdx && elIdx <= toIdx) shift = -dragSnap.height;
      else if (fromIdx > toIdx && elIdx >= toIdx && elIdx < fromIdx) shift = dragSnap.height;
      el.style.transition = "transform 0.15s ease";
      el.style.transform = `translateY(${shift}px)`;
    }
  };

  const onDragEnd = async () => {
    if (!dragId) return;

    const ord = [...order()];
    const from = ord.indexOf(dragId);
    const to = insertIdx;

    if (from !== to) {
      ord.splice(from, 1);
      ord.splice(to, 0, dragId);
      setOrder(ord);
      invoke("reorder_bookmarks", { ids: ord }).catch(console.error);
    }

    ghostEl?.remove();
    ghostEl = null;

    for (const [, el] of itemRefs) {
      el.style.transition = "none";
      el.style.transform = "";
      el.style.visibility = "";
    }

    dragId = null;

    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
  };

  onCleanup(() => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    ghostEl?.remove();
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    try {
      await invoke("delete_bookmark", { id });
      setOrder((o) => o.filter((x) => x !== id));
      triggerRefetch("refetchBookmarks");
    } catch (e) {
      console.error(e);
    }
  };

  const startEdit = (bm) => {
    setEditId(bm.id);
    setEditTitle(bm.title);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditTitle("");
  };
  const confirmEdit = async (id) => {
    const t = editTitle().trim();
    if (!t) return;
    try {
      await invoke("rename_bookmark", { id, title: t });
      cancelEdit();
      triggerRefetch("refetchBookmarks");
    } catch (e) {
      console.error(e);
    }
  };

  const handleJumpTo = (bm) => {
    const verses = parseVerses(bm.verses);
    if (!verses.length) return;
    executeBookmarkJumpTo(verses, () => setTrigger(""));
  };

  const formatDate = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div class="Bookmark-panel">
      <div class="Bookmark-header">
        <Show when={props.onClose}>
          <button class="Bookmark-close-btn" onClick={props.onClose}>
            ✕
          </button>
        </Show>
      </div>

      <div class="Bookmark-list">
        <Show when={bms.loading}>
          <p class="Bookmark-empty">Loading…</p>
        </Show>
        <Show when={!bms.loading && filtered().length === 0}>
          <p class="Bookmark-empty">{props.searchText?.()?.trim() ? "No matches found." : "No bookmarks yet."}</p>
        </Show>

        <For each={filtered()}>
          {(bm) => {
            const verses = parseVerses(bm.verses);

            return (
              <div class="Bookmark-item" ref={(el) => itemRefs.set(bm.id, el)}>
                <div class="Bookmark-drag-handle" onPointerDown={(e) => onDragStart(e, bm.id)} style={{ "touch-action": "none" }}>
                  <svg class="Bookmark-drag-icon" viewBox="0 0 10 16" fill="currentColor">
                    <circle cx="3" cy="3" r="1.2" />
                    <circle cx="7" cy="3" r="1.2" />
                    <circle cx="3" cy="8" r="1.2" />
                    <circle cx="7" cy="8" r="1.2" />
                    <circle cx="3" cy="13" r="1.2" />
                    <circle cx="7" cy="13" r="1.2" />
                  </svg>
                </div>

                <div class="Bookmark-item-body">
                  <Show
                    when={editId() === bm.id}
                    fallback={
                      <div class="Bookmark-item-top">
                        <span class="Bookmark-item-title">{bm.title}</span>
                        <div class="Bookmark-item-actions">
                          <button class="Bookmark-action-btn" title="Rename" onClick={() => startEdit(bm)}>
                            ✏️
                          </button>
                          <button class="Bookmark-action-btn Bookmark-delete-btn" title="Delete" onClick={() => handleDelete(bm.id)}>
                            🗑️
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <div class="Bookmark-item-top">
                      <input
                        class="Bookmark-input Bookmark-edit-input"
                        type="text"
                        value={editTitle()}
                        onInput={(e) => setEditTitle(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmEdit(bm.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autofocus
                      />
                      <div class="Bookmark-item-actions">
                        <button class="Bookmark-action-btn Bookmark-save-btn" onClick={() => confirmEdit(bm.id)}>
                          ✔
                        </button>
                        <button class="Bookmark-action-btn Bookmark-cancel-btn" onClick={cancelEdit}>
                          ✕
                        </button>
                      </div>
                    </div>
                  </Show>

                  {/* Compressed multi-verse reference */}
                  <div class="Bookmark-item-ref">
                    <span class="Bookmark-item-verse">{formatVerseRefs(verses)}</span>
                  </div>

                  <div class="Bookmark-item-footer">
                    <span class="Bookmark-item-date">{formatDate(bm.updated_at)}</span>
                    <button class="jump-btn" onClick={() => handleJumpTo(bm)}>
                      Go to Page ↣
                    </button>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default Bookmark;
