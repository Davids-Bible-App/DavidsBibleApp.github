import { createSignal } from "solid-js";
import { triggerRefetch } from "../State/settingsStore.js";
import { NoteModal } from "./Modals";
import GalleryManager from "./GalleryManager";
import { invoke } from "@tauri-apps/api/core";
import { executeJumpTo } from "../lib/navigationUtils";
import {
  book,
  chapterNo,
  bibleVersion,
  activeNoteVerse,
  setActiveNoteVerse,
  setTrigger,
} from "../State/globalSignals.js";
import "./CSS/SlidebarRight.css";

export default function SlidebarRight(props) {
  const [noteText, setNoteText] = createSignal("");

  const jumpTo = (hit) => {
    executeJumpTo(hit, () => {
      setTrigger("");
    });
  };

  const saveNoteSelection = async () => {
    const finalNoteText = noteText().trim();

    try {
      // 1. If the text is empty, we need to DELETE
      if (finalNoteText === "") {
        // First, we fetch the note to get its ID (since we only have the verse reference)
        const existingNote = await invoke("get_single_note", {
          translationId: bibleVersion(),
          bookId: book(),
          chapter: chapterNo(),
          verse: activeNoteVerse(),
        });

        if (existingNote && existingNote.id) {
          await invoke("delete_gallery_entry", {
            entryType: "note",
            ids: [existingNote.id], // Rust expects Vec<i32>
          });
        }
      }
      // 2. If text exists, SAVE as normal
      else {
        await invoke("save_note", {
          trans: `${bibleVersion()}.dba`,
          book: book(),
          chap: chapterNo(),
          verse: activeNoteVerse(),
          note: finalNoteText,
        });
      }

      // 3. Cleanup and Refresh
      triggerRefetch("refetchChapters", "refetchNotes");
      setActiveNoteVerse(null);
      setNoteText("");
    } catch (err) {
      console.error("Failed to process note:", err);
    }
  };

  return (
    <>
      <aside class="SlidebarRight-aside" ref={props.ref}>
        <nav>
          <div class="SlidebarRight-safe-content">
            <GalleryManager jumpTo={jumpTo} />
          </div>
        </nav>
        <div class="SlidebarRight-topShadow"></div>
      </aside>
      <NoteModal noteText={noteText} setNoteText={setNoteText} saveNoteSelection={saveNoteSelection} />
    </>
  );
}
