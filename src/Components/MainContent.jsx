import { createSignal, createEffect, onCleanup, onMount, Suspense, lazy, on } from "solid-js";
import { Portal } from "solid-js/web";
import { M3 } from "tauri-plugin-m3";
import "../State/globalClose.js";

import SlidebarLeft from "./SlidebarLeft";
import NavbarTop from "./NavbarTop";
import Splitter from "./Splitter.jsx";
import NavbarBottom from "./NavbarBottom";
import SlidebarRight from "./SlidebarRight";

import { sheetProps, createSheetReady } from "../State/sheetStore";
import TopSheet from "./TopSheet.jsx";
import BottomSheet from "./BottomSheet.jsx";
import { sheetComponents } from "../State/sheetComponents";

// prettier-ignore
import { 
  expanded, trigger, book, setBookOrderNo, setNumberOfChapters,
  isSecondaryVisible, setSecondaryVisible,
} from "../State/globalSignals.js";
import { books, translations } from "../State/globalResource.js";
import { loadAppState } from "../State/settingsStore.js";

import { initFullscreen, isFullscreen, toggleFullscreen, setFullscreen } from "../State/fullscreen.js";
import "./CSS/MainContent.css";

const DbTranslations = lazy(() => import("./DbTranslations"));
const ControlBox = lazy(() => import("./ControlBox"));
const HandlerSidebarDrag = lazy(() => import("./HandlerSidebarDrag"));
const BookmarkModal = lazy(() => import("./BookmarkModal"));
const TopicModal = lazy(() => import("./TopicModal"));

const SettingsPanel = lazy(() => import("./SettingsPanel"));
const Audio = lazy(() => import("./Audio"));
const History = lazy(() => import("./History"));
const MemeMaker = lazy(() => import("./MemeMaker"));
const SearchRef = lazy(() => import("./SearchRef"));
const CrossRef = lazy(() => import("./CrossRef"));
const StrongsVerse = lazy(() => import("./StrongsVerse"));
const StrongsLookup = lazy(() => import("./StrongsLookup"));
const Editor = lazy(() => import("./Editor"));
const Help = lazy(() => import("./Help"));

export default function MainContent() {
  // Each signal only flips true when THAT sheet first opens — never before
  const settingsReady = createSheetReady("settings");
  const audioReady = createSheetReady("audio");
  const historyReady = createSheetReady("history");
  const memeReady = createSheetReady("meme");
  const searchReady = createSheetReady("search");
  const crossrefReady = createSheetReady("crossref");
  const strongsReady = createSheetReady("strongs");
  const strlookReady = createSheetReady("strlook");
  const helpReady = createSheetReady("help");
  const editorReady = createSheetReady("editor");

  onMount(initFullscreen);

  const [activeLookup, setActiveLookup] = createSignal(null);

  // Get info from the currently displayed Translations only.
  const getInfo = (i) => translations()?.find((x) => i === x.id);

  createEffect(() => {
    if (books.state === "ready") {
      const value = books();

      for (const key in value) {
        value[key].id === book() && (setNumberOfChapters(value[key].chapter_count), setBookOrderNo(value[key].order));
      }
    }
  });

  onMount(() => {
    queueMicrotask(loadAppState);
  });

  // Get/Set Screen Dimensions - Layout ---------------------------------------

  let leftSB; // ref
  let rightSB; // ref
  let mainContainer; // ref

  const [touchActionRestored, setTouchActionRestored] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);

  const [pane, setPane] = createSignal(1);

  const [psr, setPsr] = createSignal();
  const [ssr, setSsr] = createSignal();

  const [insets, setInsets] = createSignal(false);
  const [screenOrient, setScreenOrient] = createSignal();

  const [rect, setRect] = createSignal({
    height: window.innerHeight,
    width: window.innerWidth,
  });
  const resizeHandler = async (event) => {
    setInsets(await M3.getInsets());
    setRect({ width: window.innerWidth, height: window.innerHeight });
  };
  const screenOrientation = (event) => {
    if (event.matches) {
      setScreenOrient("portrait");
      setOrientation("vertical");
    } else {
      setScreenOrient("landscape");
      setOrientation("horizontal");
      if (isSecondaryVisible()) {
        // Rotation Layout Adjust Hack
        setSecondaryVisible(false);
        setSecondaryVisible(true);
      }
    }
  };
  onMount(() => {
    let orientationQuery = window.matchMedia("(orientation: portrait)");
    orientationQuery.addEventListener("change", screenOrientation);
    screenOrientation(orientationQuery);

    window.addEventListener("resize", resizeHandler);
    resizeHandler();

    onCleanup(() => {
      orientationQuery.removeEventListener("change", screenOrientation);
      window.removeEventListener("resize", resizeHandler);
    });
  });

  createEffect(() => {
    const root = document.querySelector(":root");

    const active = !isFullscreen() && insets?.() && insets().adjustedInsetTop > 0;

    const sides = {
      top: active ? insets().adjustedInsetTop : 0,
      bottom: active ? insets().adjustedInsetBottom : 0,
      left: active ? insets().adjustedInsetLeft : 0,
      right: active ? insets().adjustedInsetRight : 0,
    };

    for (const [side, value] of Object.entries(sides)) {
      root.style.setProperty(`--edge2edge-${side}`, `${value}px`);
    }
  });

  createEffect(
    on(isFullscreen, (fullscreen, prevFullscreen) => {
      // Only act on the transition from fullscreen → not fullscreen
      if (prevFullscreen && !fullscreen) {
        // System bars restore async — give them time to settle
        setTimeout(async () => {
          setInsets(await M3.getInsets());
        }, 350);
      }
    }),
  );

  const [panelPos, setPanelPos] = createSignal(50); // In vh or vw
  const [orientation, setOrientation] = createSignal("vertical"); // 'vertical' or 'horizontal'

  const toggleSecondaryPanel = () => {
    if (!isSecondaryVisible()) {
      setPanelPos(50); // Reset to 50% on open

      screenOrient() === "portrait" ? setOrientation("vertical") : setOrientation("horizontal");
    }
    setSecondaryVisible(!isSecondaryVisible());
  };

  createEffect(() => {
    setTouchActionRestored(expanded());
  });

  // Example function to pass to other components
  const toggleTopSearchSheet = () => {
    setTopSheetState((prev) => (prev === "Hid" ? "Min" : "Hid"));
  };

  return (
    <div
      // onDblClick={toggleFullscreen}
      class="edge-to-edge"
    >
      <div class="inset-wrapper">
        <SlidebarLeft ref={leftSB} psr={psr} ssr={ssr} books={books} frozen={isDragging} />
        <SlidebarRight ref={rightSB} />
        <main ref={mainContainer} class={`Main-Content ${trigger()}`}>
          <HandlerSidebarDrag touchActionRestored={touchActionRestored} leftSB={leftSB} rightSB={rightSB} mainContainer={mainContainer} rect={rect} insets={insets} orientation={orientation} setIsDragging={setIsDragging} />
          <Show when={expanded()}>
            <Suspense
              fallback={
                <div class="loading-pulse">
                  <span />
                </div>
              }
            >
              <DbTranslations pane={pane} translations={translations} />
            </Suspense>
          </Show>
          <NavbarTop toggleSearchSheet={toggleTopSearchSheet} toggleSecondaryPanel={toggleSecondaryPanel} isSecondaryVisible={isSecondaryVisible} orientation={orientation} psr={psr} getInfo={getInfo} />
          <Splitter insets={insets} panelPos={panelPos} setPanelPos={setPanelPos} isSecondaryVisible={isSecondaryVisible} setSecondaryVisible={setSecondaryVisible} orientation={orientation} setOrientation={setOrientation} setPane={setPane} setPsr={setPsr} setSsr={setSsr} getInfo={getInfo} setTouchActionRestored={setTouchActionRestored} touchActionRestored={touchActionRestored} psr={psr} ssr={ssr} books={books} />
          <NavbarBottom psr={psr} ssr={ssr} books={books} setTouchActionRestored={setTouchActionRestored} />
          <Suspense fallback={null}>
            <ControlBox setTouchActionRestored={setTouchActionRestored} />
          </Suspense>
        </main>
      </div>

      <BottomSheet {...sheetProps("settings")} steps={["Min:50", "Max:90%"]}>
        <Show when={settingsReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <SettingsPanel />
          </Suspense>
        </Show>
      </BottomSheet>

      <BottomSheet {...sheetProps("audio")} steps={["Min:305px", "Max:90%"]}>
        <Show when={audioReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <Audio setTouchActionRestored={setTouchActionRestored} helpers={{ books, psr, ssr }} />
          </Suspense>
        </Show>
      </BottomSheet>

      <BottomSheet {...sheetProps("history")} steps={["Mid:50vh", "Max:100vh"]}>
        <Show when={historyReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <History books={books} />
          </Suspense>
        </Show>
      </BottomSheet>

      <BottomSheet {...sheetProps("help")} steps={["Max:100"]}>
        <Show when={helpReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <Help />
          </Suspense>
        </Show>
      </BottomSheet>

      <BottomSheet {...sheetProps("crossref")} steps={["Min:100px", "Mid:50vh", "Max:100vh"]}>
        <Show when={crossrefReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <CrossRef books={books} />
          </Suspense>
        </Show>
      </BottomSheet>

      <BottomSheet {...sheetProps("meme")} steps={["Max:100"]}>
        <Show when={memeReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <MemeMaker />
          </Suspense>
        </Show>
      </BottomSheet>

      <TopSheet {...sheetProps("editor")} steps={["Max:90%"]}>
        <Show when={editorReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <Editor />
          </Suspense>
        </Show>
      </TopSheet>

      <TopSheet {...sheetProps("search")} steps={["Mid:50vh", "Max:100vh"]}>
        <Show when={searchReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <SearchRef />
          </Suspense>
        </Show>
      </TopSheet>

      <TopSheet {...sheetProps("strongs")} steps={["Mid:50vh", "Max:100vh"]}>
        <Show when={strongsReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <StrongsVerse books={books} setActiveLookup={setActiveLookup} />
          </Suspense>
        </Show>
      </TopSheet>

      <TopSheet {...sheetProps("strlook")} steps={["Max:90vh"]}>
        <Show when={strlookReady()}>
          <Suspense
            fallback={
              <div class="loading-pulse">
                <span />
              </div>
            }
          >
            <StrongsLookup activeLookup={activeLookup} setActiveLookup={setActiveLookup} />
          </Suspense>
        </Show>
      </TopSheet>

      <Portal>
        <BookmarkModal />
        <TopicModal />
      </Portal>
    </div>
  );
}
