import { createSignal, onMount, onCleanup, createEffect, Show } from "solid-js";
import Bible from "./Bible";
import { type } from "@tauri-apps/plugin-os";
import HandlerSwipePager from "./HandlerSwipePager";
import handlePageChange from "../lib/handlePageChange.js";
import { handleFontResize } from "../State/settingsStore.js";
import { expanded, setExpanded } from "../State/globalSignals.js";
import { activePaper, bible1, setBible1, bible2 } from "../State/globalSignals.js";
import "./CSS/Splitter.css";

const [scrollLock, setScrollLock] = createSignal(true);
const [closeMessage, setCloseMessage] = createSignal(null);
const [navHeight, setNavHeight] = createSignal(0);
const [winScroll, setWinScroll] = createSignal(false);

// === Main Components ===

/**
 * The Primary Panel
 */
const PrimaryPanel = (props) => {
  return (
    <div class="primary-panel" style={props.style}>
      <div
        class="primary-content paper"
        classList={{ scroll_Win: winScroll(), paperOverlay: activePaper() }}
        ref={props.scrollRef}
      >
        <Bible bible={bible1} />
      </div>
    </div>
  );
};

/**
 * The DraggerBar.
 */
const DraggerBar = (props) => {
  let draggerRef;
  const [isDragging, setDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });
  const [startPos, setStartPos] = createSignal(0);

  const handleDragStart = (e) => {
    props.setTouchActionRestored(true);
    e.preventDefault();
    setDragging(true);

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    setDragStart({ x: clientX, y: clientY });
    setStartPos(props.panelPos());

    if (draggerRef) draggerRef.style.cursor = "grabbing";
    document.body.style.cursor = "grabbing";

    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("touchmove", handleDragMove, { passive: false });
    document.addEventListener("mouseup", handleDragEnd);
    document.addEventListener("touchend", handleDragEnd);
  };

  const handleDragMove = (e) => {
    if (!isDragging()) return;
    if (e.touches && e.touches.length > 1) return;
    if (e.touches) e.preventDefault();

    props.setTouchActionRestored(true);

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    // vertical
    if (props.orientation() === "vertical") {
      const deltaY = clientY - dragStart().y;
      const startPosVh = (startPos() / 100) * window.innerHeight;
      const newPosVh = ((startPosVh + deltaY) / window.innerHeight) * 100;
      props.setPanelPos(Math.max(0, Math.min(100, newPosVh)));
    } else {
      // 'horizontal'
      const deltaX = clientX - dragStart().x;
      const startPosVw = (startPos() / 100) * window.innerWidth;
      const newPosVw = ((startPosVw + deltaX) / window.innerWidth) * 100;
      props.setPanelPos(Math.max(0, Math.min(100, newPosVw)));
    }
  };

  const handleDragEnd = () => {
    if (!isDragging()) return;
    setDragging(false);
    props.setTouchActionRestored(false);

    if (draggerRef) {
      draggerRef.style.cursor = "grab";
    }
    document.body.style.cursor = "default";

    document.removeEventListener("mousemove", handleDragMove);
    document.removeEventListener("touchmove", handleDragMove);
    document.removeEventListener("mouseup", handleDragEnd);
    document.removeEventListener("touchend", handleDragEnd);

    // Closing Secondary Panel by Dragging off screen, Functions.
    const pos = props.panelPos();
    if (pos < 15) {
      // Triggered 15% from top/left
      setCloseMessage(`Closing ${props.getInfo(bible1()).english_name}.`);
      setBible1(bible2);
      setTimeout(() => setCloseMessage(null), 2500);
      props.onClose();
    } else if (pos > 85) {
      setCloseMessage(`Closing ${props.getInfo(bible2()).english_name}`);
      setTimeout(() => setCloseMessage(null), 2500);
      props.onClose();
    }
  };
  // Dynamic class for the dragger bar
  const draggerClass = () =>
    props.orientation() === "horizontal" ? "dragger-bar dragger-horizontal" : "dragger-bar dragger-vertical";

  function toggleLockCSS(e) {
    e.stopPropagation();
    const button = e.currentTarget;
    const isLocked = button.getAttribute("data-locked") === "true";
    button.setAttribute("data-locked", (!isLocked).toString());
    setScrollLock(!isLocked);
  }

  const toggleOrientation = (e) => {
    e.stopPropagation();
    props.setOrientation((o) => (o === "vertical" ? "horizontal" : "vertical"));
    props.setPanelPos(50); // Reset position on toggle
  };

  return (
    <>
      <div class={draggerClass()} ref={draggerRef} onMouseDown={handleDragStart} onTouchStart={handleDragStart}>
        <button class="paper" id="lockToggleBtn" data-locked="true" onClick={(e) => toggleLockCSS(e)}>
          <span id="lockIconContainer">
            {/* Locked Icon */}
            <svg
              id="lockedIcon"
              class="icon paper"
              classList={{ paperOverlay: activePaper() }}
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path
                fill-rule="evenodd"
                d="M8 0a4 4 0 0 1 4 4v2.05a2.5 2.5 0 0 1 2 2.45v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4M4.5 7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7zM8 1a3 3 0 0 0-3 3v2h6V4a3 3 0 0 0-3-3"
              />
            </svg>
            {/* Unlocked Icon */}
            <svg
              id="unlockedIcon"
              class="icon paper"
              classList={{ paperOverlay: activePaper() }}
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path
                fill-rule="evenodd"
                d="M8 0c1.07 0 2.041.42 2.759 1.104l.14.14.062.08a.5.5 0 0 1-.71.675l-.076-.066-.216-.205A3 3 0 0 0 5 4v2h6.5A2.5 2.5 0 0 1 14 8.5v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4M4.5 7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7z"
              />
            </svg>
          </span>
        </button>
        <div class="DraggerBar-alignBtnBox">
          <button
            class="paper"
            classList={{ paperOverlay: activePaper() }}
            onClick={() => {
              (setExpanded(!expanded()), props.setPane(1));
            }}
          >
            {props.getInfo(bible1()).short_name} &cuwed;
          </button>
          <button
            class="paper"
            classList={{ paperOverlay: activePaper() }}
            onClick={() => {
              (setExpanded(!expanded()), props.setPane(2));
            }}
          >
            {props.getInfo(bible2()).short_name} &cuvee;
          </button>
        </div>
        <button class="paper" onClick={(e) => toggleOrientation(e)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="currentColor"
            class="bi bi-arrow-repeat paper"
            classList={{ paperOverlay: activePaper() }}
            viewBox="0 0 16 16"
          >
            <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9" />
            <path
              fill-rule="evenodd"
              d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
            />
          </svg>
        </button>
      </div>
    </>
  );
};

/**
 * The Secondary Draggable Panel.
 */
const SecondaryPanel = (props) => {
  //* Dynamic style for the [Secondary panel] based on orientation and position
  let panelRef;
  const panelStyle = () => {
    const pos = props.panelPos();

    if (props.orientation() === "vertical") {
      return { height: `${100 - pos}%`, width: "100%", position: "relative" };
    } else {
      return { width: `${100 - pos}%`, height: "100%", position: "relative" };
    }
  };

  return (
    <div class="secondary-panel" ref={panelRef} style={panelStyle()}>
      <DraggerBar
        setPane={props.setPane}
        getInfo={props.getInfo}
        panelPos={props.panelPos}
        setPanelPos={props.setPanelPos}
        orientation={props.orientation}
        setOrientation={props.setOrientation}
        onClose={() => props.setSecondaryVisible(false)}
        setTouchActionRestored={props.setTouchActionRestored}
      />
      <div
        class="secondary-content paper"
        classList={{ scroll_Win: winScroll(), paperOverlay: activePaper() }}
        ref={props.scrollRef}
      >
        <Bible bible={bible2} />
      </div>
    </div>
  );
};

/**
 * The Main App Component
 * This contains all the state and logic to connect the panels.
 */
export default function Splitter(props) {
  let primaryScrollRef;
  let secondaryScrollRef;
  const [prevPrimaryScroll, setPrevPrimaryScroll] = createSignal(0);

  onMount(() => {
    setWinScroll(type() === "windows");
    const navVar = getComputedStyle(document.documentElement).getPropertyValue("--navHeight");
    const remValue = navVar ? parseFloat(navVar) : 0;
    const pxValue = remValue * parseFloat(getComputedStyle(document.documentElement).fontSize);
    setNavHeight(pxValue);
  });

  // Calculate Primary Flex Size
  const primaryPanelStyle = () => {
    if (!props.isSecondaryVisible()) return { flex: "1" }; // Full screen if no secondary

    const pos = props.panelPos();
    if (props.orientation() === "vertical") {
      return { height: `${pos}%`, width: "100%" };
    } else {
      return { width: `${pos}%`, height: "100%" };
    }
  };

  // This effect syncs the "previous" scroll value when the panel is opened,
  // so the delta calculation starts correctly.
  createEffect(() => {
    if (props.isSecondaryVisible() && primaryScrollRef) {
      setPrevPrimaryScroll(primaryScrollRef.scrollTop);
      props.setSsr(secondaryScrollRef);
    }
  });

  // This effect sets up the one-way scroll synchronization
  createEffect(() => {
    props.setPsr(primaryScrollRef);
    const primaryEl = primaryScrollRef;
    if (!primaryEl) return;
    if (!scrollLock()) return;

    const handlePrimaryScroll = () => {
      // Only sync if the secondary panel is visible and its ref is available
      if (props.isSecondaryVisible() && secondaryScrollRef) {
        const currentScroll = primaryEl.scrollTop;
        const delta = currentScroll - prevPrimaryScroll();

        secondaryScrollRef.scrollTop += delta;

        setPrevPrimaryScroll(currentScroll);
      } else {
        setPrevPrimaryScroll(primaryEl.scrollTop);
      }
    };
    // console.log(`LOG[:503]: `, px2percent(props.pageHeight()));
    primaryEl.addEventListener("scroll", handlePrimaryScroll);
    onCleanup(() => primaryEl.removeEventListener("scroll", handlePrimaryScroll));
  });

  let splitPanes; // ref

  // App Container Classes for Flex Direction
  const containerClass = () => {
    let cls = "app-container";
    if (props.isSecondaryVisible()) {
      if (props.orientation() === "vertical") cls += " flex-vertical";
      else cls += " flex-horizontal";
    }
    return cls;
  };

  return (
    <>
      <div ref={splitPanes} class={containerClass()}>
        <HandlerSwipePager
          touchActionRestored={props.touchActionRestored}
          splitPanes={splitPanes}
          onPageChange={(dir) =>
            handlePageChange(dir, {
              books: () => props.books(),
              psr: props.psr,
              ssr: props.ssr,
            })
          }
          onFontResize={(delta) => handleFontResize(delta)}
        />
        <PrimaryPanel style={primaryPanelStyle()} scrollRef={(el) => (primaryScrollRef = el)} />

        <Show when={closeMessage()}>
          <div class="close-message">{closeMessage()}</div>
        </Show>
        <Show when={props.isSecondaryVisible()}>
          <SecondaryPanel
            getInfo={props.getInfo}
            setPane={props.setPane}
            panelPos={props.panelPos}
            setPanelPos={props.setPanelPos}
            orientation={props.orientation}
            setOrientation={props.setOrientation}
            setSecondaryVisible={props.setSecondaryVisible}
            scrollRef={(el) => (secondaryScrollRef = el)}
            setTouchActionRestored={props.setTouchActionRestored}
          />
        </Show>
      </div>
    </>
  );
}
