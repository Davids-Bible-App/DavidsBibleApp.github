// State/editorStore.js
import { createSignal } from "solid-js";

// Holds an array of verse objects waiting to be inserted
export const [pendingVerses, setPendingVerses] = createSignal([]);
