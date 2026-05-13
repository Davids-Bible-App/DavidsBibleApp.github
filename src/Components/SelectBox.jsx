import { createSignal, onCleanup, Show, createMemo } from "solid-js";
import "./CSS/SelectBox.css";

export default function SelectBox(props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchTerm, setSearchTerm] = createSignal("");

  const closeDropdown = (e) => {
    if (!e.target.closest(".SelectBox-container")) setIsOpen(false);
  };

  window.addEventListener("click", closeDropdown);
  onCleanup(() => window.removeEventListener("click", closeDropdown));

  // Find the label for the current value so the UI looks clean
  const currentLabel = createMemo(() => {
    const found = props.options.find((opt) => opt.value === props.value);
    return found ? found.label : "Select Font";
  });

  const filteredOptions = createMemo(() => {
    const term = searchTerm().toLowerCase();
    if (!term) return props.options;
    return props.options.filter((opt) => opt.label.toLowerCase().includes(term));
  });

  return (
    <div class="SelectBox-container">
      <div class="SelectBox-trigger" onClick={() => setIsOpen(!isOpen())} style={{ "font-family": props.value }}>
        <span class="SelectBox-label-text">{currentLabel()}</span>
        <span class="SelectBox-arrow">{isOpen() ? "▲" : "▼"}</span>
      </div>

      <Show when={isOpen()}>
        <div
          style={props.filterKey === undefined && "padding-top:8px;"}
          class={`SelectBox-dropdown scroll_Win ${props.direction === "up" ? "is-up" : ""}`}
        >
          <Show when={props.filterKey !== undefined}>
            <div class="SelectBox-search-container">
              <input
                type="text"
                class="SelectBox-search-input"
                placeholder="Search fonts..."
                onInput={(e) => setSearchTerm(e.currentTarget.value)}
                autofocus
              />
            </div>
          </Show>

          <div class="SelectBox-scroll-area">
            {props.children(filteredOptions(), (val) => {
              props.onSelect(val);
              setIsOpen(false);
              setSearchTerm("");
            })}
          </div>
        </div>
      </Show>
    </div>
  );
}
