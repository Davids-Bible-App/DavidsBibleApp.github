import { createSignal, Show } from "solid-js";
import MdViewerModal from "./MdViewerModal";
import "./CSS/DocsButton.css";

/**
 * Lazily loads and shows Docs/<docName>.md in a modal when its trigger
 * is clicked. Nothing related to the doc is loaded until then.
 *
 * With no children, renders the default round "?" button:
 *   <DocsButton docName="Audio" />
 *
 * With children, they become the trigger instead — useful for blending
 * docs into an existing menu (e.g. a "Docs" row in a dropdown):
 *
 *  <DocsButton docName="docs/Audio">
 *   <button>Docs</button>
 *  </DocsButton>
 *
 * The children markup/styling is left entirely up to the caller —
 * DocsButton only adds the click-to-open behavior around it.
 */
export default function DocsButton(props) {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <Show
        when={props.children}
        fallback={
          <button class="DocsButton-class" type="button" aria-label={`Docs: ${props.docName}`} title={`Docs: ${props.docName}`} onClick={() => setOpen(true)}>
            ?
          </button>
        }
      >
        {/* display: contents (see CSS) means this wrapper adds a click
            handler but no box of its own, so props.children keeps
            whatever layout it has in its actual parent (e.g. a
            dropdown menu list). */}
        <span class="DocsButton-trigger" onClick={() => setOpen(true)}>
          {props.children}
        </span>
      </Show>

      <Show when={open()}>
        <MdViewerModal docName={props.docName} onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}
