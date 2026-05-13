import { createSignal, createResource, createEffect, For, Show, createMemo, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
// prettier-ignore
import {
  expandedCtl, setExpandedCtl, selectedTopic, setSelectedTopic,
  selection, setSelection, bibleVersion, topicController, setTopicController,
} from "../State/globalSignals.js";
import { registerRefetchers, triggerRefetch } from "../State/settingsStore.js";
import { abbreviator, clickOutside, groupConsecutiveVerses } from "../lib/functions.js";
import { pendingVerses, setPendingVerses } from "../State/editorStore";
import { toggleSheet } from "../State/sheetStore";
import "./CSS/GalleryManager.css";

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

    // 1. If no change, just close
    if (newNote === props.note) {
      setEditing(false);
      return;
    }

    // 2. If user cleared the text, trigger the delete logic
    if (newNote === "") {
      // We pass "note" and the id to your handleDelete function
      await props.onDelete?.("note", props.id);
    }
    // 3. Otherwise, perform a standard save
    else {
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
              rows={1}
            />
            <div style={{ "font-size": "0.75rem", color: "#888", "text-align": "right" }}>
              <span style={{ cursor: "pointer" }} onMouseDown={save}>
                Save
              </span>
              &emsp;
              <span style={{ cursor: "pointer" }} onMouseDown={cancel}>
                Cancel
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
    // Normalize to an array
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 0) return;

    // Dynamic message based on count
    const message =
      ids.length > 1
        ? `Are you sure you want to delete these ${ids.length} items?`
        : "Are you sure you want to delete this item?";

    const confirmed = await ask(message, {
      title: "Confirm Delete",
      kind: "warning",
    });
    if (!confirmed) return;

    // Send the array to Rust
    await invoke("delete_gallery_entry", { entryType: type, ids });

    if (type === "topic") {
      triggerRefetch("refetchTopics", "refetchTopicVerses");
    }

    if (type === "note") {
      triggerRefetch("refetchNotes", "refetchChapters");
    }

    if (type === "highlight") {
      triggerRefetch("refetchHighlights");
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
    triggerRefetch("refetchTopics", "refetchTopicVerses");
  };

  const handleDeleteTopicMeta = async (topicName) => {
    await invoke("delete_topic", { topic: topicName });
    triggerRefetch("refetchTopics", "refetchTopicVerses");
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
    triggerRefetch("refetchTopicVerses");
  };

  return (
    <div class="GalleryManager-main">
      <div class="GalleryManager-tabs">
        <button
          class={`btn GalleryManager-tab-btn ${activeTab() === "topic" ? "active" : ""}`}
          onClick={() => setActiveTab("topic")}
        >
          TOPICS
        </button>
        <button
          class={`btn GalleryManager-tab-btn ${activeTab() === "note" ? "active" : ""}`}
          onClick={() => setActiveTab("note")}
        >
          NOTES
        </button>
        <button
          class={`btn GalleryManager-tab-btn ${activeTab() === "highlight" ? "active" : ""}`}
          onClick={() => setActiveTab("highlight")}
        >
          HIGHLIGHTS
        </button>
      </div>

      <div class="GalleryManager-search-wrap">
        <input
          class="GalleryManager-input"
          placeholder={`Search ${activeTab()}s...`}
          value={searchText()}
          onInput={(e) => setSearchText(e.target.value)}
        />
      </div>

      <div class="GalleryManager-content">
        <Show when={activeTab() === "topic"}>
          <TopicSection
            searchText={searchText}
            setSearchText={setSearchText}
            jumpTo={props.jumpTo}
            clearSelection={props.clearSelection}
            handleDelete={handleDelete}
            onRenameTopic={handleRenameTopic}
            onDeleteTopicMeta={handleDeleteTopicMeta}
            onResetTopicOrder={handleResetTopicOrder}
          />
        </Show>
        <Show when={activeTab() === "note"}>
          <NoteSection
            searchText={searchText}
            jumpTo={props.jumpTo}
            handleDelete={handleDelete}
            onNoteSave={handleNoteSave}
          />
        </Show>
        <Show when={activeTab() === "highlight"}>
          <HighlightSection searchText={searchText} jumpTo={props.jumpTo} handleDelete={handleDelete} />
        </Show>
      </div>
    </div>
  );
}

function TopicSection(props) {
  const [topicVerses, { refetch: refetchTopicVerses, mutate: mutateVerses }] = createResource(
    () => ({ name: selectedTopic(), reset: false }),
    async ({ name, reset }) => {
      if (!name) return [];
      return await invoke("get_global_gallery", {
        filterType: "topic",
        filterTopic: name,
        resetSort: reset,
      });
    },
  );

  createEffect(() => {
    setDataExport((prev) => ({ ...prev, verses: topicVerses() }));
  });

  registerRefetchers?.({ refetchTopicVerses });

  const [metadata, { refetch: refetchTopics, mutate: mutateTopics }] = createResource(
    async () => await invoke("get_topics_metadata"),
  );
  registerRefetchers?.({ refetchTopics });

  const cleanup = registerRefetchers({
    refetchTopicVerses,
    refetchTopics,
  });

  onCleanup(() => cleanup());

  const filteredMeta = createMemo(() => {
    if (!metadata()) return [];
    const q = props.searchText().toLowerCase();
    return metadata().filter((m) => m.topic.toLowerCase().includes(q));
  });

  const formatDate = (ts) =>
    new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // --- Drag and Drop Logic: TOPICS ---
  const [draggedTopicIdx, setDraggedTopicIdx] = createSignal(null);
  const [draggedGroupIdx, setDraggedGroupIdx] = createSignal(null);

  const handleTopicDrop = async (e, dropIdx) => {
    e.preventDefault();
    const dragIdx = draggedTopicIdx();
    if (dragIdx === null || dragIdx === dropIdx) return;

    const newList = [...filteredMeta()];
    const [moved] = newList.splice(dragIdx, 1);
    newList.splice(dropIdx, 0, moved);
    mutateTopics(newList);
    setDraggedTopicIdx(null);

    const orderedNames = newList.map((t) => t.topic);
    await invoke("update_topics_order", { orderedTopics: orderedNames });
  };

  const handleGroupDrop = async (e, dropIdx) => {
    e.preventDefault();
    const dragIdx = draggedGroupIdx();
    if (dragIdx === null || dragIdx === dropIdx) return;

    const currentGroups = groupConsecutiveVerses(topicVerses() || [], false, true);

    const [movedGroup] = currentGroups.splice(dragIdx, 1);
    currentGroups.splice(dropIdx, 0, movedGroup);

    const newVerses = currentGroups.flat();
    mutateVerses(newVerses);
    setDraggedGroupIdx(null);

    const orderedIds = newVerses.map((v) => v.id);
    await invoke("update_verses_order", { orderedIds: orderedIds });
  };

  const handleSave = async (topicName) => {
    const target = topicName || props.searchText();
    if (!topicController() || !target || !selection().length) return;
    const verses = selection().map((v) => [
      `${v.tr}.dba` || `${bibleVersion()}.dba`,
      v.bk,
      parseInt(v.ch),
      parseInt(v.vs),
    ]);
    await invoke("save_verses_to_topic", { verses, topic: target });
    props.setSearchText("");
    refetchTopics();
    setSelectedTopic(target);
    setExpandedCtl(0);
    setSelection([]);
    setTopicController(false);
  };

  return (
    <Show
      when={!selectedTopic()}
      fallback={
        <div class="TopicSection-detail">
          <div class="TopicSection-header">
            <button
              onClick={() => setSelectedTopic(null)}
              style={{
                padding: "10px",
                border: "none",
                color: "var(--text-color)",
                cursor: "pointer",
              }}
            >
              ← Back to Topics (<span class="Entry-ref">{selectedTopic()}</span>)
            </button>
            <TopicActions topic={selectedTopic()} onResetOrder={props.onResetTopicOrder} />
          </div>
          <TopicDescription topic={selectedTopic()} />
          {/* Grouped Verses View (Draggable) */}
          <For each={groupConsecutiveVerses(topicVerses() || [], false, true)}>
            {(group, index) => {
              // Each group gets its own permission state
              const [canDrag, setCanDrag] = createSignal(false);

              return (
                <div
                  draggable={canDrag()}
                  onDragStart={() => setDraggedGroupIdx(index())}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    handleGroupDrop(e, index());
                    setCanDrag(false); // Reset after drop
                  }}
                  onDragEnd={() => setCanDrag(false)} // Reset if drag is cancelled
                  style={{
                    transition: "opacity 0.2s",
                  }}
                >
                  <GroupedVerseCard
                    group={group}
                    currentVerses={() => topicVerses() || []} // Pass the full list getter
                    onRefresh={() => refetchTopicVerses()} // Pass the refresh function
                    jumpTo={props.jumpTo}
                    handleDelete={props.handleDelete}
                    onNoteSave={props.onNoteSave}
                    isDraggable={true}
                    onHandleDown={() => setCanDrag(true)}
                  />
                </div>
              );
            }}
          </For>
        </div>
      }
    >
      <Show
        when={topicController() && props.searchText() && !filteredMeta().some((m) => m.topic === props.searchText())}
      >
        <button
          onClick={() => handleSave()}
          style={{
            width: "100%",
            padding: "15px",
            background: "var(--ThemeCtrl2)",
            color: "var(--text-color)",
            border: "none",
            "border-bottom": "1px solid #444",
            cursor: "pointer",
          }}
        >
          Create Topic: "{props.searchText()}" with {selection().length} verses
        </button>
      </Show>

      {/* Topics List (Draggable) */}
      <For each={filteredMeta()}>
        {(m, index) => {
          // Each group gets its own permission state
          const [canDrag, setCanDrag] = createSignal(false);
          return (
            <div
              class="TopicSection-item"
              draggable={!props.searchText() && canDrag()} // Disable drag if searching to maintain indices
              onDragStart={() => setDraggedTopicIdx(index())}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                handleTopicDrop(e, index());
                setCanDrag(false); // Reset after drop
              }}
              onDragEnd={() => setCanDrag(false)} // Reset if drag is cancelled
              style={{
                transition: "opacity 0.2s",
                display: "flex",
                "align-items": "center",
                gap: "10px",
              }}
              onClick={() =>
                topicController() && selection().length ? handleSave(m.topic) : setSelectedTopic(m.topic)
              }
            >
              {/* Topic Drag Handle */}
              <Show when={!props.searchText()}>
                <div
                  style={{ cursor: "grab", color: "#777", "font-size": "1.2rem", padding: "0 10px" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setCanDrag(true);
                  }}
                >
                  ☰
                </div>
              </Show>

              <div style={{ flex: 1 }}>
                <div style={{ "font-size": "1.1rem" }}>{m.topic}</div>
                <div style={{ color: "#888", "font-size": "0.8rem" }}>verses: {m.count}</div>
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                <div style={{ "text-align": "right", color: "#888", "font-size": "0.8rem" }}>
                  <div>{formatDate(m.updated)}</div>
                  <div style={{ "margin-top": "5px" }}>🔗</div>
                </div>
                <TopicActions topic={m.topic} onRename={props.onRenameTopic} onDeleteTopic={props.onDeleteTopicMeta} />
              </div>
            </div>
          );
        }}
      </For>
    </Show>
  );
}

function NoteSection(props) {
  const [data, { refetch: refetchNotes }] = createResource(
    async () => await invoke("get_global_gallery", { filterType: "note", filterTopic: "All" }),
  );
  registerRefetchers?.({ refetchNotes });

  const cleanup = registerRefetchers({
    refetchNotes,
  });

  onCleanup(() => cleanup());

  const filtered = createMemo(
    () => data()?.filter((e) => (e.note || "").toLowerCase().includes(props.searchText().toLowerCase())) || [],
  );

  return (
    <For each={groupConsecutiveVerses(filtered(), false, true)}>
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
  );
}

function HighlightSection(props) {
  const [data, { refetch: refetchHighlights }] = createResource(
    async () => await invoke("get_global_gallery", { filterType: "highlight", filterTopic: "All" }),
  );
  registerRefetchers?.({ refetchHighlights });

  const cleanup = registerRefetchers({
    refetchHighlights,
  });

  onCleanup(() => cleanup());

  const filtered = createMemo(
    () => data()?.filter((e) => e.text.toLowerCase().includes(props.searchText().toLowerCase())) || [],
  );

  return (
    <For each={groupConsecutiveVerses(filtered(), false, true)}>
      {(group) => (
        <GroupedVerseCard group={group} jumpTo={props.jumpTo} handleDelete={props.handleDelete} isDraggable={false} />
      )}
    </For>
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
    return f.verse_id === l.verse_id
      ? `${f.book_name} ${f.chapter}:${f.verse_id}`
      : `${f.book_name} ${f.chapter}:${f.verse_id}-${l.verse_id}`;
  };

  return (
    <div class="Entry-card" style={{ display: "flex", "flex-direction": "column" }}>
      <Show when={selected().size > 0}>
        <div class="DeleteBar">
          <span onClick={deleteSelected} style={{ cursor: "pointer" }} title="Delete">
            🗑️ ({selected().size})
          </span>

          <Show when={props.group.length > 1}>
            <Show when={props.isDraggable && selected().size !== props.group.length}>
              <span
                style="display:flex;align-items:center;"
                class="DeleteBar-action"
                onClick={handleUngroup}
                title="Ungroup"
              >
                <svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 9H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M12 15L12 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path
                    d="M6 4C6 5.10457 5.10457 6 4 6C2.89543 6 2 5.10457 2 4C2 2.89543 2.89543 2 4 2C5.10457 2 6 2.89543 6 4Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <path
                    d="M6 20C6 21.1046 5.10457 22 4 22C2.89543 22 2 21.1046 2 20C2 18.8954 2.89543 18 4 18C5.10457 18 6 18.8954 6 20Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <path
                    d="M22 4C22 5.10457 21.1046 6 20 6C18.8954 6 18 5.10457 18 4C18 2.89543 18.8954 2 20 2C21.1046 2 22 2.89543 22 4Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <path
                    d="M22 20C22 21.1046 21.1046 22 20 22C18.8954 22 18 21.1046 18 20C18 18.8954 18.8954 18 20 18C21.1046 18 22 18.8954 22 20Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <path d="M18 4H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M20 18L20 12M20 6V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M18 20L12 20M6 20L8 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M4 6L4 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                &nbsp; ({selected().size})
              </span>
            </Show>
            <span
              style="display:flex;align-items:center;"
              class="DeleteBar-action"
              onClick={selectAll}
              title="Select All"
            >
              <svg
                fill="currentColor"
                height="14px"
                width="14px"
                version="1.1"
                id="Layer_1"
                xmlns="http://www.w3.org/2000/svg"
                xmlns:xlink="http://www.w3.org/1999/xlink"
                viewBox="0 0 202.622 202.622"
                xml:space="preserve"
              >
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

      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <div class="Entry-ref" onClick={() => props.jumpTo(first())}>
          {refLabel()}
          <span style={{ "margin-left": "10px" }}>({abbreviator(first().translation_id)})</span>
        </div>

        <Show when={props.isDraggable}>
          <div
            style={{ cursor: "grab", color: "#777", "font-size": "1.2rem", padding: "0 5px" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              props.onHandleDown?.();
            }}
          >
            ☰
          </div>
        </Show>
      </div>

      <For each={props.group}>
        {(entry) => (
          <div class={`GroupedVerse-row ${selected().has(entry.id) ? "Verse-selected" : ""}`}>
            <div
              class="Entry-text Entry-highlight-border"
              style={{ "--color": entry.highlight }}
              onDblClick={() => toggleSelect(entry.id)}
              onPointerDown={(e) => startLongPress(e, entry.id)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
            >
              <span class="Entry-verse-num">{entry.verse_id}.</span>
              {entry.text}
            </div>

            <Show when={entry.note}>
              <EditableNote
                note={entry.note}
                id={entry.id}
                onSave={props.onNoteSave}
                onDelete={(type, id) => props.handleDelete(type, id)}
              />
            </Show>
          </div>
        )}
      </For>
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
        <span>{expanded() ? "▼" : "▶"}</span>
        <span style={{ "text-decoration": data() ? "none" : "underline" }}>
          {data() ? "Topic Description" : "Add description..."}
        </span>
      </div>

      <Show when={expanded()}>
        <div style={{ "margin-top": "10px", display: "flex", "flex-direction": "column" }}>
          <textarea
            class="TopicDescription-textarea"
            value={draft()}
            onInput={(e) => setDraft(e.target.value)}
            placeholder="Describe the purpose of this topic..."
          />
          <div class="TopicDescription-actions">
            <span class="TopicDescription-btn cancel" onClick={handleCancel}>
              Cancel
            </span>
            <span class="TopicDescription-btn save" onClick={handleSave}>
              Save Description
            </span>
          </div>
        </div>
      </Show>
    </div>
  );
}
