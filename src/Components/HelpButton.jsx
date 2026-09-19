import { createSignal, Show } from "solid-js";
import MdViewerModal from "./MdViewerModal";
import "./CSS/HelpButton.css";

/**
 * Lazily loads and shows Docs/<docName>.md in a modal when its trigger
 * is clicked. Nothing related to the doc is loaded until then.
 *
 * With no children, renders the default round "?" button:
 *   <HelpButton docName="Audio" />
 *
 * With children, they become the trigger instead — useful for blending
 * help into an existing menu (e.g. a "Help" row in a dropdown):
 *   <HelpButton docName="Audio">
 *     <button class="dropdown-item">Help</button>
 *   </HelpButton>
 *
 * The children markup/styling is left entirely up to the caller —
 * HelpButton only adds the click-to-open behavior around it.
 */
export default function HelpButton(props) {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <Show
        when={props.children}
        fallback={
          <button class="HelpButton-class" type="button" aria-label={`Help: ${props.docName}`} title={`Help: ${props.docName}`} onClick={() => setOpen(true)}>
            ?
          </button>
        }
      >
        {/* display: contents (see CSS) means this wrapper adds a click
            handler but no box of its own, so props.children keeps
            whatever layout it has in its actual parent (e.g. a
            dropdown menu list). */}
        <span class="HelpButton-trigger" onClick={() => setOpen(true)}>
          {props.children}
        </span>
      </Show>

      <Show when={open()}>
        <MdViewerModal docName={props.docName} onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}
