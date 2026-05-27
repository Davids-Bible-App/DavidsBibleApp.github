import { Show, createEffect, createResource } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { abbreviator, getBook } from "../lib/functions.js";
import { activeNoteVerse, setActiveNoteVerse, book, chapterNo, bibleVersion, targetVerse, setTargetVerse } from "../State/globalSignals.js";
import "./CSS/Modals.css";

export function NoteModal(props) {
  const [selectedNote] = createResource(
    () => ({
      v: activeNoteVerse(),
      b: book(),
      c: chapterNo(),
      t: bibleVersion(),
    }),
    async (p) => {
      if (!p.v) return null;
      return await invoke("get_single_note", {
        translationId: p.t,
        bookId: p.b,
        chapter: p.c,
        verse: p.v,
      });
    },
  );

  createEffect(() => {
    const data = selectedNote();
    props.setNoteText(data?.note ?? "");
  });

  createEffect(() => {
    if (activeNoteVerse() == null) {
      props.setNoteText("");
      setTargetVerse("");
    }
  });

  return (
    <Show when={activeNoteVerse()}>
      <div class="modal-overlay" onClick={() => setActiveNoteVerse(null)}>
        <div class="modal-card note-modal" onClick={(e) => e.stopPropagation()}>
          <h3>
            Note for {getBook(book())} {chapterNo()}:{activeNoteVerse()} (&nbsp
            {abbreviator(bibleVersion())}&nbsp)
          </h3>
          <p class="modal-verse">{selectedNote()?.text || targetVerse()}</p>
          <textarea
            class="modal-textarea"
            placeholder="Write your study notes here..."
            value={props.noteText()}
            onInput={(e) => props.setNoteText(e.currentTarget.value)}
            // autofocus
          />
          <div class="modal-actions">
            <button
              class="BMModal-btn BMModal-btn--cancel"
              onClick={() => {
                setActiveNoteVerse(null);
                props.setNoteText("");
              }}
            >
              Cancel
            </button>
            <button class="BMModal-btn BMModal-btn--save" onClick={props.saveNoteSelection}>
              Save Note
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
