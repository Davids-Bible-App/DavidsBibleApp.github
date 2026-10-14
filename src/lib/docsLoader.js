// docsLoader.js
//
// <DocsButton docName="docs/Audio">
//   <button>Docs</button>
// </DocsButton>
//
// Builds a map of { "./Audio.md": () => import("./Audio.md?raw") } at build
// time. The functions are NOT called here, so none of these files are
// fetched/parsed until loadDoc(name) is actually invoked by a click.
//
// Vite still code-splits each file into its own chunk because the import
// stays dynamic (no `eager: true`). This is what gives us "only the file
// the user asked for, only when they ask for it."
const docModules = import.meta.glob("../Docs/**/*.md", { query: "?raw", import: "default" });

/**
 * Lazily loads the raw markdown text for a given doc name.
 * @param {string} name - e.g. "Audio", "Meme", "History", "Compare"
 * @returns {Promise<string>} raw markdown source
 */
export function loadDoc(name) {
  const clean = name.replace(/^\/+/, "").replace(/\.md$/i, "");
  const loader = docModules[`../Docs/${clean}.md`];

  if (!loader) {
    return Promise.reject(new Error(`No docs doc found for "${name}" (expected Docs/${name}.md)`));
  }

  return loader();
}

// Bonus: list every doc, e.g. for an index or table of contents.
// Returns names like "facts/file", "help/Audio", "Intro".
export function listDocs() {
  return Object.keys(docModules).map((p) => p.replace("../Docs/", "").replace(/\.md$/, ""));
}
