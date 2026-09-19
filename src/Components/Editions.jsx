import { createSignal, createEffect, For, onMount } from "solid-js";
import "./CSS/Editions.css";
import { clickOutside } from "../lib/functions.js"; // KEEP: Use:d in nav outerWrap class

const [dropDown, setDropDown] = createSignal(false);

export default function Editions(props) {
  onMount(() => {
    setDropDown(false);
  });
  return (
    <>
      <nav>
        <div
          class="Editions-outerWrap"
          use:clickOutside={() => setDropDown(false)} // KEEP: Use:d Solidjs specific
          style={dropDown() && "background: var(--background-opaque);backdrop-filter: var(--glassBlur);"}
        >
          <div class="Editions-dropper" onClick={() => setDropDown(!dropDown())}>
            <span>{props.files.length}&nbsp;</span>
            Editions &emsp;
            <span class="Editions-caret" classList={{ "Editions-rotate": !dropDown() }}>
              ▲
            </span>
          </div>
          <content style={dropDown() ? "height: 7.5rem;padding-block-end: 0.4rem;" : "height: 0;"}>
            <div class="Editions-selectionBtns">
              <button onClick={() => props.setFiles({}, "isActive", true)}>ALL</button>
              <button onClick={() => props.setFiles({}, "isActive", false)}>NONE</button>
            </div>
            <div class="Editions-scroller">
              <ul>
                <For each={props.files} fallback={<div>No items</div>}>
                  {(item) => <BibleEdition mountVer={props.mountVer} edition={item.edition} isActive={item.isActive} files={props.files} setFiles={props.setFiles} />}
                </For>
              </ul>
            </div>
          </content>
        </div>
      </nav>
    </>
  );
}

const BibleEdition = (props) => {
  const [checkedEdition, setCheckedEdition] = createSignal(false);

  onMount(() => {
    props.setFiles((file) => file.edition === props.mountVer, "isActive", true);
    props.mountVer === props.edition && setCheckedEdition(true);
  });

  createEffect(() => {
    props.files.map((file) => {
      if (file.edition === props.edition) {
        setCheckedEdition(file.isActive);
      }
    });
  });

  return (
    <>
      <li
        class="BibleEdition-listItem"
        onClick={(e) =>
          setCheckedEdition((isActive) => {
            if (!isActive) {
              props.setFiles((f) => f.edition === e.currentTarget.firstElementChild.innerText, "isActive", true);
              return true;
            } else {
              props.setFiles((f) => f.edition === e.currentTarget.firstElementChild.innerText, "isActive", false);
              return false;
            }
          })
        }
      >
        <span class="BibleEdition-file">{props.edition} </span>
        <span class="BibleEdition-icon" classList={{ "BibleEdition-iconColor": checkedEdition() }}>
          {checkedEdition() ? "✓" : "𐄂"}
        </span>
      </li>
    </>
  );
};
