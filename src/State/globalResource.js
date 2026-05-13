import { createResource, createRoot } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { bible1 } from "./globalSignals.js";

// We execute createRoot and immediately export the returned resources
export const { books, translations } = createRoot(() => {
  const [booksResource] = createResource(
    () => bible1(), // Tracking the signal
    async (file) => await invoke("get_books", { translationFile: `${file}.dba` }),
  );

  const [translationsResource] = createResource(
    () => bible1(),
    async (file) => await invoke("get_translations", { translationFile: `${file}.dba` }),
  );

  return {
    books: booksResource,
    translations: translationsResource,
  };
});
