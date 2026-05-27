import { createSignal, createEffect, onCleanup, onMount, Suspense, lazy } from "solid-js";
import "../State/globalClose.js";
import { M3 } from "tauri-plugin-m3";

import HandlerSidebarDrag from "./HandlerSidebarDrag.jsx";
import SlidebarLeft from "./SlidebarLeft";
import NavbarTop from "./NavbarTop";
import Splitter from "./Splitter.jsx";
import NavbarBottom from "./NavbarBottom";
import SlidebarRight from "./SlidebarRight";

import { Portal } from "solid-js/web";
import BookmarkModal from "./BookmarkModal.jsx";
import TopicModal from "./TopicModal.jsx";

const DbTranslations = lazy(() => import("./DbTranslations"));
const Audio = lazy(() => import("./Audio"));
const SettingsPanel = lazy(() => import("./SettingsPanel"));
const ControlBox = lazy(() => import("./ControlBox"));
import "./CSS/MainContent.css";

import { sheetProps } from "../State/sheetStore";
import TopSheet from "./TopSheet.jsx";
import BottomSheet from "./BottomSheet.jsx";
const History = lazy(() => import("./History"));
const MemeMaker = lazy(() => import("./MemeMaker"));
const SearchRef = lazy(() => import("./SearchRef"));
const CrossRef = lazy(() => import("./CrossRef"));
const StrongsVerse = lazy(() => import("./StrongsVerse"));
const StrongsLookup = lazy(() => import("./StrongsLookup"));
const Editor = lazy(() => import("./Editor"));
const Help = lazy(() => import("./Help"));

import { loadSessionState } from "../State/settingsStore.js";
// prettier-ignore
import { 
  expanded, trigger, book, setBookOrderNo, setNumberOfChapters,
  isSecondaryVisible, setSecondaryVisible,
} from "../State/globalSignals.js";
import { books, translations } from "../State/globalResource.js";

export default function MainContent() {
  onMount(() => {
    // Idle pre-fetch — chunk loads in background after critical path is done
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
    idle(() => {
      import("./Audio");
      import("./SettingsPanel");
      import("./DbTranslations");
      import("./ControlBox");
      import("./History.jsx");
      import("./MemeMaker.jsx");
      import("./SearchRef.jsx");
      import("./CrossRef.jsx");
      import("./StrongsVerse.jsx");
      import("./StrongsLookup.jsx");
      import("./Editor.jsx");
      import("./Help.jsx");
    });
  });
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
    queueMicrotask(loadSessionState);
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

  createEffect(async () => {
    // Set css styles in the root element
    const root = document.querySelector(":root");
    if (insets && insets().adjustedInsetTop > 0) {
      root.style.setProperty("--edge2edge-top", insets().adjustedInsetTop + "px");
      root.style.setProperty("--edge2edge-bottom", insets().adjustedInsetBottom + "px");
      root.style.setProperty("--edge2edge-left", insets().adjustedInsetLeft + "px");
      root.style.setProperty("--edge2edge-right", insets().adjustedInsetRight + "px");
    } else {
      root.style.setProperty("--edge2edge-top", "0px");
      root.style.setProperty("--edge2edge-bottom", "0px");
      root.style.setProperty("--edge2edge-left", "0px");
      root.style.setProperty("--edge2edge-right", "0px");
    }
  });

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
    <div class="edge-to-edge">
      <div class="inset-wrapper">
        <SlidebarLeft ref={leftSB} psr={psr} ssr={ssr} books={books} frozen={isDragging} />
        <SlidebarRight ref={rightSB} />
        <main ref={mainContainer} class={`Main-Content ${trigger()}`}>
          <HandlerSidebarDrag touchActionRestored={touchActionRestored} leftSB={leftSB} rightSB={rightSB} mainContainer={mainContainer} rect={rect} insets={insets} orientation={orientation} setIsDragging={setIsDragging} />
          <Suspense fallback={null}>
            <DbTranslations pane={pane} translations={translations} />
          </Suspense>
          <NavbarTop toggleSearchSheet={toggleTopSearchSheet} toggleSecondaryPanel={toggleSecondaryPanel} isSecondaryVisible={isSecondaryVisible} orientation={orientation} psr={psr} getInfo={getInfo} />
          <Splitter insets={insets} panelPos={panelPos} setPanelPos={setPanelPos} isSecondaryVisible={isSecondaryVisible} setSecondaryVisible={setSecondaryVisible} orientation={orientation} setOrientation={setOrientation} setPane={setPane} setPsr={setPsr} setSsr={setSsr} getInfo={getInfo} setTouchActionRestored={setTouchActionRestored} touchActionRestored={touchActionRestored} psr={psr} ssr={ssr} books={books} />
          <NavbarBottom psr={psr} ssr={ssr} books={books} setTouchActionRestored={setTouchActionRestored} />
          <Suspense fallback={null}>
            <ControlBox setTouchActionRestored={setTouchActionRestored} />
          </Suspense>
        </main>
      </div>
      <BottomSheet {...sheetProps("help")} steps={["Max:100"]}>
        <Suspense fallback={null}>
          <Help />
        </Suspense>
      </BottomSheet>
      <BottomSheet {...sheetProps("crossref")} steps={["Min:100px", "Mid:50vh", "Max:100vh"]}>
        <Suspense fallback={null}>
          <CrossRef books={books} />
        </Suspense>
      </BottomSheet>
      <BottomSheet {...sheetProps("history")} steps={["Mid:50vh", "Max:100vh"]}>
        <Suspense fallback={null}>
          <History books={books} />
        </Suspense>
      </BottomSheet>
      <BottomSheet {...sheetProps("meme")} steps={["Max:100"]}>
        <Suspense fallback={null}>
          <MemeMaker />
        </Suspense>
      </BottomSheet>
      <BottomSheet {...sheetProps("settings")} steps={["Min:540px", "Max:90%"]}>
        <Suspense fallback={null}>
          <SettingsPanel />
        </Suspense>
      </BottomSheet>
      <TopSheet {...sheetProps("editor")} steps={["Max:90%"]}>
        <Suspense fallback={null}>
          <Editor />
        </Suspense>
      </TopSheet>
      <TopSheet {...sheetProps("search")} steps={["Min:125px", "Mid:50vh", "Max:100vh"]}>
        <Suspense fallback={null}>
          <SearchRef />
        </Suspense>
      </TopSheet>
      <TopSheet {...sheetProps("strongs")} steps={["Mid:50vh", "Max:100vh"]}>
        <Suspense fallback={null}>
          <StrongsVerse books={books} setActiveLookup={setActiveLookup} />
        </Suspense>
      </TopSheet>
      <TopSheet {...sheetProps("strlook")} steps={["Max:90vh"]}>
        <Suspense fallback={null}>
          <StrongsLookup activeLookup={activeLookup} setActiveLookup={setActiveLookup} />
        </Suspense>
      </TopSheet>
      <BottomSheet {...sheetProps("audio")} steps={["Min:305px", "Max:90%"]}>
        <Suspense fallback={null}>
          <Audio setTouchActionRestored={setTouchActionRestored} helpers={{ books, psr, ssr }} />
        </Suspense>
      </BottomSheet>

      <Portal>
        <BookmarkModal />
        <TopicModal />
      </Portal>
    </div>
  );
}
