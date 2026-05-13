import { createSignal, createEffect, For, onMount } from "solid-js";
import "./CSS/Editions.css";
import { clickOutside } from "../lib/functions.js"; // Use:d in nav outerWrap class

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
          use:clickOutside={() => setDropDown(false)}
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
                  {(item) => (
                    <BibleEdition
                      mountVer={props.mountVer}
                      edition={item.edition}
                      isActive={item.isActive}
                      files={props.files}
                      setFiles={props.setFiles}
                    />
                  )}
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

// Checkmark
{
  /* <svg width="10px" height="10px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <path
    fill="currentColor"
    d="M17.47 250.9C88.82 328.1 158 397.6 224.5 485.5c72.3-143.8 146.3-288.1 268.4-444.37L460 26.06C356.9 135.4 276.8 238.9 207.2 361.9c-48.4-43.6-126.62-105.3-174.38-137z"
  />
</svg>; */
}
