import { createSignal, createResource, createEffect, For, Show, createMemo, onMount, onCleanup, Suspense, lazy } from "solid-js";
import { Portal } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { type } from "@tauri-apps/plugin-os";
// prettier-ignore
import {
  expandedCtl, setExpandedCtl, selectedTopic, setSelectedTopic,
  selection, setSelection, bibleVersion, topicController, setTopicController,
  showUniTopic, setShowUniTopic,
  trigger
} from "../State/globalSignals.js";
import Bookmark from "./Bookmark.jsx";
import { registerRefetchers, triggerRefetch } from "../State/settingsStore.js";
import { topicVerses, refetchTopicVerses, mutateTopicVerses as mutateVerses, topicTarget, closeTopicModal, topicMetadata, refetchTopicMetadata, mutateTopics } from "../State/modalStore.js";
import { abbreviator, clickOutside, groupConsecutiveVerses } from "../lib/functions.js";
import { pendingVerses, setPendingVerses } from "../State/editorStore";
import { toggleSheet } from "../State/sheetStore";
import "./CSS/GalleryManager.css";

import ToastStack, { showToast } from "./Toast";
const UniVerse = lazy(() => import("./UniVerse"));

const [dataExport, setDataExport] = createSignal({ verses: {}, text: "" });

function EditableNote(props) {
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal(props.note || "");

  let textareaRef;

  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    textareaRef.style.height = textareaRef.scrollHeight + "px";
  };

  const startEdit = () => {
    setEditing(true);
    queueMicrotask(autoResize);
  };

  const save = async () => {
    const newNote = value().trim();

    if (newNote === props.note) {
      setEditing(false);
      return;
    }

    if (newNote === "") {
      await props.onDelete?.("note", props.id);
    } else {
      await props.onSave?.(props.id, newNote);
      triggerRefetch("refetchChapters", "refetchNotes");
    }

    setEditing(false);
  };

  const cancel = () => {
    setValue(props.note || "");
    setEditing(false);
  };

  return (
    <div class="Entry-note">
      <Show
        when={!editing()}
        fallback={
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <textarea
              ref={textareaRef}
              value={value()}
              onInput={(e) => {
                setValue(e.target.value);
                autoResize();
              }}
              class="Entry-note-textarea"
              rows={5}
            />
            <div style={{ "text-align": "right" }}>
              <span class="BMModal-btn BMModal-btn--cancel sm" onClick={cancel}>
                Cancel
              </span>
              &nbsp;
              <span class="BMModal-btn BMModal-btn--save sm" onClick={save}>
                Save
              </span>
            </div>
          </div>
        }
      >
        <div onClick={startEdit} style={{ cursor: "text" }}>
          📝 {props.note}
        </div>
      </Show>
    </div>
  );
}

function TopicActions(props) {
  const [open, setOpen] = createSignal(false);

  const rename = async () => {
    setOpen(false);
    const newName = prompt("Rename topic:", props.topic);
    if (!newName || newName.trim() === "" || newName === props.topic) return;
    await props.onRename?.(props.topic, newName.trim());
  };

  const resetOrder = async () => {
    setOpen(false);
    const confirmed = await ask(`Reset verse order for "${props.topic}" to default (Biblical order)?`, {
      title: "Reset Order",
      kind: "warning",
    });
    if (!confirmed) return;
    await props.onResetOrder?.(props.topic);
  };

  const remove = async () => {
    setOpen(false);
    const confirmed = await ask(`Delete topic "${props.topic}" and all its verses?`, {
      title: "Delete Topic",
      kind: "warning",
    });
    if (!confirmed) return;
    await props.onDeleteTopic?.(props.topic);
  };

  const sendToEditor = () => {
    const versesToExport = dataExport().verses;
    if (versesToExport.length === 0) return;

    const selectedObj = [];

    selectedObj.push({ topic: dataExport()?.topic, description: dataExport()?.text });

    versesToExport.forEach((v) => {
      selectedObj.push({
        ed: abbreviator(v.translation_id),
        translation: v.translation_id.replace(/\.dba$/i, ""),
        book_id: v.book_id,
        chapter: v.chapter,
        verse: v.verse_id,
        text: v.text,
      });
    });

    setPendingVerses(selectedObj);
    toggleSheet("editor", "Max");
  };

  return (
    <div style={{ position: "relative" }}>
      <span
        style={{ cursor: "pointer", "font-size": "1.2rem", padding: "0 5px" }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        use:clickOutside={() => setOpen(false)}
      >
        ⋮
      </span>
      <Show when={open()}>
        <div class="TopicActions-menu" onClick={(e) => e.stopPropagation()}>
          <Show when={dataExport().verses?.length > 0}>
            <div class="TopicActions-item" onClick={sendToEditor}>
              Export To Editor
            </div>
          </Show>
          <Show when={props.onRename}>
            <div class="TopicActions-item" onClick={rename}>
              Rename Topic
            </div>
          </Show>
          <Show when={props.onResetOrder}>
            <div class="TopicActions-item" onClick={resetOrder}>
              Reset Order
            </div>
          </Show>
          <Show when={props.onDeleteTopic}>
            <div class="TopicActions-item TopicActions-danger" onClick={remove}>
              Delete Topic
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// --- 1. Main Manager (Shell) ---

export default function GalleryManager(props) {
  const [activeTab, setActiveTab] = createSignal("topic");
  const [searchText, setSearchText] = createSignal("");

  const clearSelection = () => {
    setSelection([]);
  };

  createEffect(() => {
    if (expandedCtl() === 0) {
      clearSelection();
    }
  });

  const handleDelete = async (type, idOrIds) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 0) return;

    const message = ids.length > 1 ? `Are you sure you want to delete these ${ids.length} items?` : "Are you sure you want to delete this item?";

    const confirmed = await ask(message, {
      title: "Confirm Delete",
      kind: "warning",
    });
    if (!confirmed) return;

    await invoke("delete_gallery_entry", { entryType: type, ids });

    if (type === "topic") {
      triggerRefetch("refetchTopics", "refetchTopicVerses", "refetchTopicMetadata");
      console.log(`LOG[:227]: `, "refetchTopicMetadata");
    }

    if (type === "note") {
      triggerRefetch("refetchNotes", "refetchChapters");
    }
  };

  const handleNoteSave = async (id, newNote) => {
    await invoke("save_note_by_id", { id, note: newNote });
    triggerRefetch("refetchNotes");
    setExpandedCtl(0);
    setSelection([]);
  };

  const handleRenameTopic = async (oldName, newName) => {
    await invoke("rename_topic", { oldTopic: oldName, newTopic: newName });
    triggerRefetch("refetchTopics", "refetchTopicVerses", "refetchTopicMetadata");
  };

  const handleDeleteTopicMeta = async (topicName) => {
    await invoke("delete_topic", { topic: topicName });
    triggerRefetch("refetchTopics", "refetchTopicVerses", "refetchTopicMetadata");
  };

  const handleResetTopicOrder = async (topicName) => {
    // 1. Get verses in biblical order
    const defaultVerses = await invoke("get_global_gallery", {
      filterType: "topic",
      filterTopic: topicName,
      resetSort: true,
    });

    // 2. Extract IDs and update the sort order in DB
    const orderedIds = defaultVerses.map((v) => v.id);
    await invoke("update_verses_order", { orderedIds });

    // 3. Refresh UI
    triggerRefetch("refetchTopics", "refetchTopicVerses", "refetchTopicMetadata");
  };

  return (
    <div class="GalleryManager-main">
      <div class="GalleryManager-tabs">
        <button class={`btn GalleryManager-tab-btn ${activeTab() === "topic" ? "active" : ""}`} onClick={() => setActiveTab("topic")}>
          TOPICS
        </button>
        <button class={`btn GalleryManager-tab-btn ${activeTab() === "note" ? "active" : ""}`} onClick={() => setActiveTab("note")}>
          NOTES
        </button>
        <button class={`btn GalleryManager-tab-btn ${activeTab() === "bookmark" ? "active" : ""}`} onClick={() => setActiveTab("bookmark")}>
          BOOKMARKS
        </button>
      </div>
      {/* Uni-wrap for inline padding - Style adjust for scroll-gutters stable */}
      <div class="GalleryManager-undertab" style={type() === "android" && "padding-inline: 14px;"}>
        <Show when={activeTab() !== "topic" || (activeTab() === "topic" && !selectedTopic())}>
          <div class="GalleryManager-search-wrap" style={type() === "windows" && "padding-inline: 10px;"}>
            <input class="GalleryManager-input" placeholder={`Search ${activeTab()}s...`} value={searchText()} onInput={(e) => setSearchText(e.target.value)} />
          </div>
        </Show>

        <div class="GalleryManager-content" classList={{ scroll_Win: activeTab() === "topic" && !selectedTopic() }}>
          <Show when={activeTab() === "topic"}>
            <TopicSection searchText={searchText} setSearchText={setSearchText} jumpTo={props.jumpTo} clearSelection={props.clearSelection} handleDelete={handleDelete} onRenameTopic={handleRenameTopic} onDeleteTopicMeta={handleDeleteTopicMeta} onResetTopicOrder={handleResetTopicOrder} />
          </Show>
          <Show when={activeTab() === "note"}>
            <NoteSection searchText={searchText} jumpTo={props.jumpTo} handleDelete={handleDelete} onNoteSave={handleNoteSave} />
          </Show>
          <Show when={activeTab() === "bookmark"}>
            <div class="GalleryManager-card-wrap scroll_Win">
              <Bookmark searchText={searchText} />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function TopicSection(props) {
  createEffect(() => {
    setDataExport((prev) => ({ ...prev, verses: topicVerses() }));
  });

  registerRefetchers?.({ refetchTopicVerses });

  const metadata = topicMetadata;

  const filteredMeta = createMemo(() => {
    if (!metadata()) return [];
    const q = props.searchText().toLowerCase();
    return metadata().filter((m) => m.topic.toLowerCase().includes(q));
  });

  const formatDate = (ts) => new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // ── TOPICS drag ───────────────────────────────────────────────────────────────
  const topicItemRefs = new Map();
  let topicSnapRects = new Map();
  let topicGhostEl = null;
  let topicDragId = null;
  let topicStartY = 0;
  let topicInsertIdx = 0;
  let topicOrdSnap = []; // snapshot of id-order at drag-start

  const onTopicDragStart = (e, id) => {
    if (props.searchText()) return; // indices are meaningless while filtered
    e.preventDefault();

    topicDragId = id;
    topicStartY = e.clientY;
    topicOrdSnap = filteredMeta().map((m) => m.topic);

    topicSnapRects = new Map();
    for (const [tid, el] of topicItemRefs) {
      const r = el.getBoundingClientRect();
      topicSnapRects.set(tid, { top: r.top, left: r.left, width: r.width, height: r.height });
    }
    topicInsertIdx = topicOrdSnap.indexOf(id);

    const srcEl = topicItemRefs.get(id);
    const snap = topicSnapRects.get(id);
    const computed = window.getComputedStyle(srcEl);

    topicGhostEl = srcEl.cloneNode(true);
    Object.assign(topicGhostEl.style, {
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
      // borderRadius: "1rem",
      boxShadow: "0 14px 36px rgba(0,0,0,0.38), 0 4px 12px rgba(0,0,0,0.24)",
      opacity: "0.98",
      fontSize: "0.9rem",
      fontFamily: "Georgia",
      transform: "scale(1.01)",
      transformOrigin: "center center",
      overflow: "hidden",
    });
    document.body.appendChild(topicGhostEl);
    srcEl.style.visibility = "hidden";

    window.addEventListener("pointermove", onTopicDragMove, { passive: false });
    window.addEventListener("pointerup", onTopicDragEnd);
  };

  const onTopicDragMove = (e) => {
    if (!topicDragId) return;
    e.preventDefault();

    topicGhostEl.style.transform = `scale(1.01) translateY(${e.clientY - topicStartY}px)`;

    const ord = topicOrdSnap;
    const fromIdx = ord.indexOf(topicDragId);
    const dragSnap = topicSnapRects.get(topicDragId);

    const above = ord
      .filter((id) => id !== topicDragId)
      .filter((id) => {
        const r = topicSnapRects.get(id);
        return r && r.top + r.height / 2 < e.clientY;
      }).length;

    const toIdx = Math.max(0, Math.min(above, ord.length - 1));
    topicInsertIdx = toIdx;

    for (const [id, el] of topicItemRefs) {
      if (id === topicDragId) continue;
      const elIdx = ord.indexOf(id);
      let shift = 0;
      if (fromIdx < toIdx && elIdx > fromIdx && elIdx <= toIdx) shift = -dragSnap.height;
      else if (fromIdx > toIdx && elIdx >= toIdx && elIdx < fromIdx) shift = dragSnap.height;
      el.style.transition = "transform 0.15s ease";
      el.style.transform = `translateY(${shift}px)`;
    }
  };

  const onTopicDragEnd = async () => {
    if (!topicDragId) return;

    const from = topicOrdSnap.indexOf(topicDragId);
    const to = topicInsertIdx;

    if (from !== to) {
      const newList = [...filteredMeta()];
      const [moved] = newList.splice(from, 1);
      newList.splice(to, 0, moved);
      mutateTopics(newList);
      invoke("update_topics_order", { orderedTopics: newList.map((t) => t.topic) }).catch(console.error);
    }

    topicGhostEl?.remove();
    topicGhostEl = null;

    for (const [, el] of topicItemRefs) {
      el.style.transition = "none";
      el.style.transform = "";
      el.style.visibility = "";
    }

    topicDragId = null;
    window.removeEventListener("pointermove", onTopicDragMove);
    window.removeEventListener("pointerup", onTopicDragEnd);
  };

  // ── GROUPS drag ───────────────────────────────────────────────────────────────
  let capturedGroupPointer = null;
  const groupItemRefs = new Map();
  let groupSnapRects = new Map();
  let groupGhostEl = null;
  let groupDragId = null; // first verse id of the group = stable key
  let groupStartY = 0;
  let groupInsertIdx = 0;
  let groupOrdSnap = []; // snapshot at drag-start
  let groupsSnap = []; // snapshot of full group arrays for reorder
  let groupPointerId = null;

  const onGroupDragStart = (e, id) => {
    e.preventDefault();

    groupDragId = id;
    groupStartY = e.clientY;
    groupPointerId = e.pointerId; // ← store it
    groupsSnap = groupConsecutiveVerses(topicVerses() || [], false, true, false, false);
    groupOrdSnap = groupsSnap.map((g) => g[0].id);

    groupSnapRects = new Map();
    for (const [gid, el] of groupItemRefs) {
      const r = el.getBoundingClientRect();
      groupSnapRects.set(gid, { top: r.top, left: r.left, width: r.width, height: r.height });
    }
    groupInsertIdx = groupOrdSnap.indexOf(id);

    const srcEl = groupItemRefs.get(id);
    const snap = groupSnapRects.get(id);
    const computed = window.getComputedStyle(srcEl);

    srcEl.setPointerCapture(e.pointerId); // ← all future pointer events route here

    groupGhostEl = srcEl.cloneNode(true);
    Object.assign(groupGhostEl.style, {
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
      borderRadius: "1rem",
      boxShadow: "0 14px 36px rgba(0,0,0,0.38), 0 4px 12px rgba(0,0,0,0.24)",
      opacity: "0.98",
      fontSize: "1rem",
      fontFamily: "Georgia",
      transform: "scale(1.01)",
      transformOrigin: "center center",
      overflow: "hidden",
    });
    document.body.appendChild(groupGhostEl);
    srcEl.style.visibility = "hidden";

    window.addEventListener("pointermove", onGroupDragMove, { passive: false });
    window.addEventListener("pointerup", onGroupDragEnd);
    window.addEventListener("pointercancel", onGroupDragEnd); // ← Android's "browser took over"
  };

  const onGroupDragMove = (e) => {
    if (!groupDragId) return;
    e.preventDefault();

    groupGhostEl.style.transform = `scale(1.01) translateY(${e.clientY - groupStartY}px)`;

    const ord = groupOrdSnap;
    const fromIdx = ord.indexOf(groupDragId);
    const dragSnap = groupSnapRects.get(groupDragId);

    const above = ord
      .filter((id) => id !== groupDragId)
      .filter((id) => {
        const r = groupSnapRects.get(id);
        return r && r.top + r.height / 2 < e.clientY;
      }).length;

    const toIdx = Math.max(0, Math.min(above, ord.length - 1));
    groupInsertIdx = toIdx;

    for (const [id, el] of groupItemRefs) {
      if (id === groupDragId) continue;
      const elIdx = ord.indexOf(id);
      let shift = 0;
      if (fromIdx < toIdx && elIdx > fromIdx && elIdx <= toIdx) shift = -dragSnap.height;
      else if (fromIdx > toIdx && elIdx >= toIdx && elIdx < fromIdx) shift = dragSnap.height;
      el.style.transition = "transform 0.15s ease";
      el.style.transform = `translateY(${shift}px)`;
    }
  };

  const onGroupDragEnd = async () => {
    if (!groupDragId) return;

    // Release pointer capture before anything else
    const srcEl = groupItemRefs.get(groupDragId);
    if (srcEl && groupPointerId !== null) {
      try {
        srcEl.releasePointerCapture(groupPointerId);
      } catch (_) {}
    }
    groupPointerId = null;

    const from = groupOrdSnap.indexOf(groupDragId);
    const to = groupInsertIdx;

    if (from !== to) {
      const reordered = [...groupsSnap];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      const newVerses = reordered.flat();
      mutateVerses(newVerses);
      invoke("update_verses_order", { orderedIds: newVerses.map((v) => v.id) }).catch(console.error);
    }

    groupGhostEl?.remove();
    groupGhostEl = null;

    for (const [, el] of groupItemRefs) {
      el.style.transition = "none";
      el.style.transform = "";
      el.style.visibility = "";
    }

    groupDragId = null;
    window.removeEventListener("pointermove", onGroupDragMove);
    window.removeEventListener("pointerup", onGroupDragEnd);
    window.removeEventListener("pointercancel", onGroupDragEnd); // ← clean up
  };

  const uniVerse = async () => {
    if (topicVerses().length > 0) setShowUniTopic(true);
  };

  // ── TWO-FINGER EXPAND (pinch-out) → opens UniVerse ───────────────────────
  let _pinchStartDist = null;
  let _pinchFired = false;

  const _getGalleryTouchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const _onGalleryPinchStart = (e) => {
    if (topicDragId || groupDragId) return; // don't clash with an active drag
    if (e.touches.length === 2) {
      e.preventDefault();
      _pinchStartDist = _getGalleryTouchDist(e.touches);
      _pinchFired = false;
    }
  };

  const _onGalleryPinchMove = (e) => {
    if (e.touches.length !== 2 || _pinchStartDist === null || _pinchFired) return;
    if (topicDragId || groupDragId) return; // drag started after pinch began
    e.preventDefault();
    const delta = _getGalleryTouchDist(e.touches) - _pinchStartDist;
    if (delta > 55) {
      _pinchFired = true;
      selectedTopic() && trigger() === "right" && uniVerse();
    }
  };

  const _onGalleryPinchEnd = () => {
    _pinchStartDist = null;
    _pinchFired = false;
  };

  createEffect(() => {
    if (selectedTopic()) {
      document.addEventListener("touchstart", _onGalleryPinchStart, { passive: true });
      document.addEventListener("touchmove", _onGalleryPinchMove, { passive: true });
      document.addEventListener("touchend", _onGalleryPinchEnd, { passive: true });
    } else {
      document.removeEventListener("touchstart", _onGalleryPinchStart);
      document.removeEventListener("touchmove", _onGalleryPinchMove);
      document.removeEventListener("touchend", _onGalleryPinchEnd);
    }
  });

  // Safety cleanup if the component unmounts mid-drag
  onCleanup(() => {
    window.removeEventListener("pointermove", onTopicDragMove);
    window.removeEventListener("pointerup", onTopicDragEnd);
    window.removeEventListener("pointermove", onGroupDragMove);
    window.removeEventListener("pointerup", onGroupDragEnd);
    window.removeEventListener("pointercancel", onGroupDragEnd); // ← add
    topicGhostEl?.remove();
    groupGhostEl?.remove();
    // ── pinch cleanup ──────────────────────────────────────────────
    document.removeEventListener("touchstart", _onGalleryPinchStart);
    document.removeEventListener("touchmove", _onGalleryPinchMove);
    document.removeEventListener("touchend", _onGalleryPinchEnd);
  });

  return (
    <>
      <Show
        when={!selectedTopic()}
        fallback={
          <div class="TopicSection-detail">
            <Show when={selectedTopic()}>
              <div class="TopicSection-header" style={type() === "windows" && "padding-inline: 10px;"}>
                <button onClick={() => setSelectedTopic(null)} class="jump-btn">
                  ↢ Back to Topics
                </button>
                <TopicActions topic={selectedTopic()} onResetOrder={props.onResetTopicOrder} />
              </div>
            </Show>
            <TopicDescription topic={selectedTopic()} />
            {/* Grouped Verses View (Draggable) */}
            <div class="GalleryManager-card-wrap scroll_Win">
              {/* <button onClick={() => uniVerse()}>uniVerse</button> */}
              <For each={groupConsecutiveVerses(topicVerses() || [], false, true, false, false)}>
                {(group) => {
                  const groupId = group[0].id;
                  return (
                    <div
                      ref={(el) => {
                        groupItemRefs.set(groupId, el);
                        el.addEventListener(
                          "pointerdown",
                          (e) => {
                            capturedGroupPointer = e;
                          },
                          { capture: true },
                        );
                      }}
                      style={{ "touch-action": "pan-y" }}
                    >
                      <GroupedVerseCard
                        group={group}
                        currentVerses={() => topicVerses() || []}
                        onRefresh={() => refetchTopicVerses()}
                        jumpTo={props.jumpTo}
                        handleDelete={props.handleDelete}
                        onNoteSave={props.onNoteSave}
                        isDraggable={true}
                        onHandleDown={() => {
                          if (capturedGroupPointer) onGroupDragStart(capturedGroupPointer, groupId);
                          capturedGroupPointer = null;
                        }}
                      />
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        }
      >
        {/* Topics List (Draggable) */}
        <For each={filteredMeta()} fallback={<p class="Bookmark-empty">No Topics Yet</p>}>
          {(m) => {
            const topicId = m.topic;
            return (
              <div class="TopicSection-item" ref={(el) => topicItemRefs.set(topicId, el)} onClick={() => setSelectedTopic(m.topic)} style={type() === "android" && "padding-inline: 5px;"}>
                <div
                  class="TopicSection-drag-handle"
                  style={!props.searchText() ? "cursor: grab; touch-action: none; padding: 0 6px; color: var(--main-icon-text-color);" : "cursor: not-allowed; padding: 0 6px; color: #777"}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onTopicDragStart(e, topicId);
                  }}
                >
                  <svg viewBox="0 0 10 16" fill="currentColor" style={{ width: "12px", height: "18px" }}>
                    <circle cx="3" cy="3" r="1.2" />
                    <circle cx="7" cy="3" r="1.2" />
                    <circle cx="3" cy="8" r="1.2" />
                    <circle cx="7" cy="8" r="1.2" />
                    <circle cx="3" cy="13" r="1.2" />
                    <circle cx="7" cy="13" r="1.2" />
                  </svg>
                </div>

                <div style="display:flex;flex-direction:column;width:100%;">
                  <div style="font-size:1.1rem; flex:1;">🏷️ {m.topic}</div>

                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                    <div style="color:var(--main-icon-text-color);font-size:0.8rem;opacity:0.6;">verses: {m.count}</div>
                    <div style="color:var(--main-icon-text-color);font-size:0.8rem;opacity:0.6;">{formatDate(m.updated)}</div>
                  </div>
                </div>
                <TopicActions topic={m.topic} onRename={props.onRenameTopic} onDeleteTopic={props.onDeleteTopicMeta} />
              </div>
            );
          }}
        </For>
      </Show>

      <Portal>
        <Show when={showUniTopic()}>
          <Suspense>
            <UniVerse uniTopic={topicVerses} />
          </Suspense>
        </Show>
      </Portal>
    </>
  );
}

function NoteSection(props) {
  const [data, { refetch: refetchNotes }] = createResource(async () => await invoke("get_global_gallery", { filterType: "note", filterTopic: "All" }));
  registerRefetchers?.({ refetchNotes });

  const cleanup = registerRefetchers({
    refetchNotes,
  });

  onCleanup(() => cleanup());

  const filtered = createMemo(() => data()?.filter((e) => (e.note || "").toLowerCase().includes(props.searchText().toLowerCase())) || []);

  return (
    <div class="GalleryManager-card-wrap scroll_Win">
      <For each={groupConsecutiveVerses(filtered(), false, true, false, false)} fallback={<p class="Bookmark-empty">No Notes Yet</p>}>
        {(group) => (
          <GroupedVerseCard
            group={group}
            jumpTo={props.jumpTo}
            handleDelete={props.handleDelete}
            onNoteSave={props.onNoteSave}
            isDraggable={false} // No dragging for notes
          />
        )}
      </For>
    </div>
  );
}

function GroupedVerseCard(props) {
  const [selected, setSelected] = createSignal(new Set());

  const toggleSelect = (id) => {
    const next = new Set(selected());
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    const all = new Set(props.group.map((v) => v.id));
    setSelected(all);
  };

  const cancelSelection = () => {
    setSelected(new Set());
  };

  let longPressTimer = null;

  const startLongPress = (e, id) => {
    if (!e.isPrimary) {
      cancelLongPress(); // ← also cancel if a second finger arrives mid-press
      return;
    }
    e.preventDefault();
    longPressTimer = setTimeout(() => toggleSelect(id), 450);
  };

  const cancelLongPress = () => clearTimeout(longPressTimer);

  const deleteSelected = async () => {
    const selectedIds = Array.from(selected());
    if (selectedIds.length === 0) return;

    // Grab the first entry to determine the type (note, topic, etc.)
    const firstEntry = props.group.find((v) => v.id === selectedIds[0]);

    if (firstEntry) {
      // Call handleDelete ONCE with the whole array of IDs
      await props.handleDelete(firstEntry.entry_type, selectedIds);

      triggerRefetch("refetchChapters");
    }

    // Clear selection
    setSelected(new Set());
  };

  const handleUngroup = async () => {
    // To ungroup, we move the selected verses to the very end of the list
    // This breaks the consecutive visual grouping in the Topic view.
    const selectedIds = Array.from(selected());
    const allVerses = props.currentVerses(); // We need access to the full list

    const remaining = allVerses.filter((v) => !selectedIds.includes(v.id));
    const toMove = allVerses.filter((v) => selectedIds.includes(v.id));

    const newOrder = [...remaining, ...toMove].map((v) => v.id);

    await invoke("update_verses_order", { orderedIds: newOrder });
    props.onRefresh?.();
    setSelected(new Set());
  };

  const first = () => props.group[0];
  const last = () => props.group[props.group.length - 1];

  const refLabel = () => {
    const f = first();
    const l = last();
    return f.verse_id === l.verse_id ? `${f.book_name} ${f.chapter}:${f.verse_id}` : `${f.book_name} ${f.chapter}:${f.verse_id}-${l.verse_id}`;
  };

  return (
    <div class="Entry-card">
      <Show when={props.isDraggable}>
        <div
          class="Bookmark-drag-handle"
          onPointerDown={(e) => {
            e.stopPropagation();
            props.onHandleDown?.();
          }}
        >
          <svg viewBox="0 0 10 16" fill="currentColor" style={{ width: "12px", height: "18px" }}>
            <circle cx="3" cy="3" r="1.2" />
            <circle cx="7" cy="3" r="1.2" />
            <circle cx="3" cy="8" r="1.2" />
            <circle cx="7" cy="8" r="1.2" />
            <circle cx="3" cy="13" r="1.2" />
            <circle cx="7" cy="13" r="1.2" />
          </svg>
        </div>
      </Show>
      <div class="Entry-item-body">
        <Show when={selected().size > 0}>
          <div class="DeleteBar">
            <span onClick={deleteSelected} style={{ cursor: "pointer" }} title="Delete">
              🗑️ ({selected().size})
            </span>

            <Show when={props.group.length > 1}>
              <Show when={props.isDraggable && selected().size !== props.group.length}>
                <span style="display:flex;align-items:center;" class="DeleteBar-action" onClick={handleUngroup} title="Ungroup">
                  <svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 9H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M12 15L12 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M6 4C6 5.10457 5.10457 6 4 6C2.89543 6 2 5.10457 2 4C2 2.89543 2.89543 2 4 2C5.10457 2 6 2.89543 6 4Z" stroke="currentColor" stroke-width="1.5" />
                    <path d="M6 20C6 21.1046 5.10457 22 4 22C2.89543 22 2 21.1046 2 20C2 18.8954 2.89543 18 4 18C5.10457 18 6 18.8954 6 20Z" stroke="currentColor" stroke-width="1.5" />
                    <path d="M22 4C22 5.10457 21.1046 6 20 6C18.8954 6 18 5.10457 18 4C18 2.89543 18.8954 2 20 2C21.1046 2 22 2.89543 22 4Z" stroke="currentColor" stroke-width="1.5" />
                    <path d="M22 20C22 21.1046 21.1046 22 20 22C18.8954 22 18 21.1046 18 20C18 18.8954 18.8954 18 20 18C21.1046 18 22 18.8954 22 20Z" stroke="currentColor" stroke-width="1.5" />
                    <path d="M18 4H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M20 18L20 12M20 6V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M18 20L12 20M6 20L8 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M4 6L4 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                  &nbsp; ({selected().size})
                </span>
              </Show>
              <span style="display:flex;align-items:center;" class="DeleteBar-action" onClick={selectAll} title="Select All">
                <svg fill="currentColor" height="14px" width="14px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 202.622 202.622" xml:space="preserve">
                  <g>
                    <g>
                      <g>
                        <path
                          d="M198.724,0.001h-81.828H113h-11.69h-3.897h-11.69h-3.897h-11.69h-3.897h-11.69h-3.897h-11.69h-3.897h-11.69h-3.897H7.793
				H3.897C1.745,0.001,0,1.745,0,3.897v11.69v3.897v11.69v3.897v11.69v3.897v11.69v3.897v11.69v3.897v11.69v3.897v11.69v3.891
				v85.724c0,2.152,1.745,3.897,3.897,3.897h194.828c2.152,0,3.897-1.745,3.897-3.897V3.897
				C202.621,1.745,200.876,0.001,198.724,0.001z M194.828,194.829H7.793v-70.138h3.897c2.152,0,3.897-1.745,3.897-3.897
				c0-2.152-1.745-3.897-3.897-3.897H7.793v-3.896v-3.897v-11.69v-3.897v-11.69v-3.897v-11.69v-3.897v-11.69v-3.897v-11.69v-3.897
				v-11.69v-3.897V7.794h11.69h3.897h11.69h3.897h11.69h3.897h11.69h3.897h11.69h3.897h11.69h3.897H113h3.897h3.896
				c-2.153,0-3.896,1.745-3.896,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897s3.897-1.745,3.897-3.897v-3.897
				c0-2.152-1.745-3.897-3.896-3.897h74.033V194.829z"
                        />
                        <path
                          d="M120.793,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C124.69,118.641,122.945,116.897,120.793,116.897z"
                        />
                        <path
                          d="M105.207,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C109.103,118.641,107.359,116.897,105.207,116.897z"
                        />
                        <path
                          d="M89.621,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C93.517,118.641,91.772,116.897,89.621,116.897z"
                        />
                        <path
                          d="M120.793,54.553c-2.152,0-3.897,1.745-3.897,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897
				c2.152,0,3.897-1.745,3.897-3.897v-3.897C124.69,56.298,122.945,54.553,120.793,54.553z"
                        />
                        <path
                          d="M120.793,101.311c-2.152,0-3.897,1.745-3.897,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897
				c2.152,0,3.897-1.745,3.897-3.897v-3.897C124.69,103.055,122.945,101.311,120.793,101.311z"
                        />
                        <path
                          d="M120.793,70.139c-2.152,0-3.897,1.745-3.897,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897
				c2.152,0,3.897-1.745,3.897-3.897v-3.897C124.69,71.883,122.945,70.139,120.793,70.139z"
                        />
                        <path
                          d="M74.034,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C77.931,118.641,76.186,116.897,74.034,116.897z"
                        />
                        <path
                          d="M120.793,85.725c-2.152,0-3.897,1.745-3.897,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897
				c2.152,0,3.897-1.745,3.897-3.897v-3.897C124.69,87.469,122.945,85.725,120.793,85.725z"
                        />
                        <path
                          d="M27.276,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C31.172,118.641,29.428,116.897,27.276,116.897z"
                        />
                        <path
                          d="M120.793,23.38c-2.152,0-3.897,1.745-3.897,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897
				c2.152,0,3.897-1.745,3.897-3.897v-3.897C124.69,25.125,122.945,23.38,120.793,23.38z"
                        />
                        <path
                          d="M42.862,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C46.759,118.641,45.014,116.897,42.862,116.897z"
                        />
                        <path
                          d="M120.793,38.967c-2.152,0-3.897,1.745-3.897,3.897v3.897c0,2.152,1.745,3.897,3.897,3.897
				c2.152,0,3.897-1.745,3.897-3.897v-3.897C124.69,40.711,122.945,38.967,120.793,38.967z"
                        />
                        <path
                          d="M58.448,116.897h-3.897c-2.152,0-3.897,1.745-3.897,3.897s1.745,3.897,3.897,3.897h3.897
				c2.152,0,3.897-1.745,3.897-3.897C62.345,118.641,60.6,116.897,58.448,116.897z"
                        />
                      </g>
                    </g>
                  </g>
                </svg>
                &nbsp; (ALL)
              </span>
            </Show>

            <span class="DeleteBar-action" onClick={cancelSelection}>
              Cancel
            </span>
          </div>
        </Show>
        <div class="Entry-header">
          <div class="entry-ref">
            {refLabel()}
            <span>({abbreviator(first().translation_id)})</span>
          </div>
          <button
            class="jump-btn"
            onClick={() => {
              props.jumpTo(first());
            }}
          >
            Go to Verse ↣
          </button>
        </div>
        <For each={props.group}>
          {(entry) => (
            <div class={`GroupedVerse-row ${selected().has(entry.id) ? "Verse-selected" : ""}`}>
              <div class="Entry-text" style={{ "--color": entry.highlight }} onPointerDown={(e) => startLongPress(e, entry.id)} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress} onPointerCancel={cancelLongPress} onDblClick={() => toggleSelect(entry.id)}>
                <span class="Entry-verse-num">{entry.verse_id}.</span>
                {entry.text}
              </div>

              <Show when={entry.note}>
                <EditableNote note={entry.note} id={entry.id} onSave={props.onNoteSave} onDelete={(type, id) => props.handleDelete(type, id)} />
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function TopicDescription(props) {
  const [expanded, setExpanded] = createSignal(false);
  const [data, { refetch }] = createResource(
    () => props.topic,
    async (name) => await invoke("get_topic_description", { topic: name }),
  );

  createEffect(() => {
    setDataExport((prev) => ({ ...prev, topic: props.topic, text: data() || "" }));
  });

  const [draft, setDraft] = createSignal("");

  createEffect(() => {
    setDraft(data() || "");
  });

  const handleSave = async () => {
    await invoke("save_topic_description", {
      topic: props.topic,
      description: draft(),
    });
    refetch();
    setExpanded(false);
  };

  const handleCancel = () => {
    setDraft(data() || "");
    setExpanded(false);
  };

  return (
    <div class="TopicDescription-root">
      <div class="TopicDescription-toggle" onClick={() => setExpanded(!expanded())}>
        <span class="entry-ref bg">🏷️ {selectedTopic()}</span>
        <span>
          <span>{expanded() ? "▼" : "▶"}</span>&nbsp;
          <span style={{ color: data() ? "var(--text-color-highlights)" : "currentColor" }}>{data() ? "Described" : "Describe"}</span>
          &emsp;
        </span>
      </div>

      <Show when={expanded()}>
        <div style={{ "margin-top": "10px", display: "flex", "flex-direction": "column" }}>
          <textarea class="TopicDescription-textarea" value={draft()} onInput={(e) => setDraft(e.target.value)} placeholder="Describe the purpose of this topic..." />
          <div class="TopicDescription-actions">
            <span class="BMModal-btn BMModal-btn--cancel sm" onClick={handleCancel}>
              Cancel
            </span>
            <span class="BMModal-btn BMModal-btn--save sm" onClick={handleSave}>
              Save Description
            </span>
          </div>
        </div>
      </Show>
    </div>
  );
}
