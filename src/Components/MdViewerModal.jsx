import { createResource, Show, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { marked } from "marked";
import { loadDoc } from "../lib/docsLoader";
import "./CSS/MdViewerModal.css";

marked.setOptions({
  gfm: true,
  breaks: false,
});

async function fetchAndParse(name) {
  const raw = await loadDoc(name);
  return marked.parse(raw);
}

/**
 * Modal that lazily fetches Docs/<docName>.md (via docsLoader's
 * import.meta.glob map) and renders it with `marked`.
 *
 * The fetch only happens when this component mounts, i.e. only after
 * HelpButton has been clicked — never on app load.
 */
export default function MdViewerModal(props) {
  const [html] = createResource(() => props.docName, fetchAndParse);

  let dialogRef;

  const handleKeydown = (e) => {
    if (e.key === "Escape") props.onClose();
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    dialogRef?.focus();
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeydown);
  });

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  return (
    <Portal>
      <div class="MdViewerModal-backdrop" onClick={handleBackdropClick}>
        <div class="MdViewerModal-class" role="dialog" aria-modal="true" aria-label={`${props.docName} help`} tabindex="-1" ref={dialogRef}>
          <div class="MdViewerModal-header">
            <h2 class="MdViewerModal-title">{props.docName} Help</h2>
            <button class="MdViewerModal-close" type="button" aria-label="Close" onClick={props.onClose}>
              &times;
            </button>
          </div>

          <div class="MdViewerModal-scroll">
            <Show when={!html.loading} fallback={<p class="MdViewerModal-loading">Loading…</p>}>
              <Show when={!html.error} fallback={<p class="MdViewerModal-error">{html.error?.message ?? "Couldn't load this help topic."}</p>}>
                {/* Content comes from your own bundled .md files, not
                    user input, so raw innerHTML is fine here. If you ever
                    load remote/user-supplied markdown, sanitize first. */}
                <div class="MdViewerModal-content" innerHTML={html()} />
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
