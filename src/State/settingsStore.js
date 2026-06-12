import { createStore } from "solid-js/store";
import { createEffect, createRoot } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { toggleSheet } from "./sheetStore";
import { showToast } from "../Components/Toast";
import { isDarkMode } from "../State/globalSignals.js";
import { keepScreenOn } from "tauri-plugin-keep-screen-on-api";
import { isFullscreen, setFullscreen } from "../state/fullscreen.js";

// prettier-ignore
import { 
  bible1, setBible1, book, setBook, chapterNo, setChapterNo,
  chapterBtn, setChapterBtn, bookBtn, setBookBtn, testamentBtn, setTestamentBtn,
  wordHighlight, setWordHighlight, setActivePaper,
} from "../State/globalSignals.js";

export const [settings, setSettings] = createStore({
  firstName: "David",
  fontSize: 2,
  themeHue: 250,
  bgImage: "none",
  titleView: true,
  sideLightsLight: false,
  sideLightsDark: true,
  alphaDarkHighlight: 0.55,
  alphaDarkSidelight: 0.8,
  alphaLightHighlight: 0.4,
  alphaLightSidelight: 1.0,
  fullscreenOn: false,
  keepScreenOn: false,
  leatherTexture: false,
  navTopSwipe1: "search:Min",
  navTopSwipe2: "history:Max",
  navTopDblClick: "meme:Min",
  navTopLongPress: "settings:Mid",
  navBotSwipe1: "history:Mid",
  navBotSwipe2: "search:Max",
  navBotDblClick: "bookmarks:Min",
  navBotLongPress: "settings:Mid",
});

const SESSION_KEYS = ["bible1", "book", "chapterNo", "testamentBtn", "bookBtn", "chapterBtn", "wordHighlight"];
// prettier-ignore
const SETTINGS_KEYS = [
  "firstName", "fontSize", "themeHue", "bgImage", "titleView",
  "sideLightsLight", "sideLightsDark", "alphaDarkHighlight", "alphaDarkSidelight",
  "alphaLightHighlight", "alphaLightSidelight", "fullscreenOn", "keepScreenOn", "leatherTexture",
  "navTopSwipe1", "navTopSwipe2", "navTopDblClick", "navTopLongPress",
  "navBotSwipe1", "navBotSwipe2", "navBotDblClick", "navBotLongPress",
];
// Load all settings from SQLite
export async function loadAppState(scope = "all") {
  const keys = scope === "session" ? SESSION_KEYS : scope === "settings" ? SETTINGS_KEYS : [...SESSION_KEYS, ...SETTINGS_KEYS];
  try {
    const res = await invoke("get_configs", { keys });

    if (scope !== "settings") {
      if (res.bible1) setBible1(res.bible1);
      if (res.book) setBook(res.book);
      if (res.chapterNo) setChapterNo(parseInt(res.chapterNo, 10));
      if (res.testamentBtn) setTestamentBtn(res.testamentBtn);
      if (res.bookBtn) setBookBtn(res.bookBtn);
      if (res.chapterBtn) setChapterBtn(parseInt(res.chapterBtn, 10));
      if (res.wordHighlight) setWordHighlight(res.wordHighlight === "true");
    }

    if (scope !== "session") {
      setSettings({
        firstName: res.firstName ?? "David",
        fontSize: res.fontSize ? parseFloat(res.fontSize) : 2,
        themeHue: res.themeHue ? parseInt(res.themeHue, 10) : 250,
        bgImage: res.bgImage ?? "none",
        titleView: res.titleView != null ? res.titleView === "true" : true,
        sideLightsLight: res.sideLightsLight != null ? res.sideLightsLight === "true" : false,
        sideLightsDark: res.sideLightsDark != null ? res.sideLightsDark === "true" : true,
        alphaDarkHighlight: res.alphaDarkHighlight ? parseFloat(res.alphaDarkHighlight) : 0.55,
        alphaDarkSidelight: res.alphaDarkSidelight ? parseFloat(res.alphaDarkSidelight) : 0.8,
        alphaLightHighlight: res.alphaLightHighlight ? parseFloat(res.alphaLightHighlight) : 0.4,
        alphaLightSidelight: res.alphaLightSidelight ? parseFloat(res.alphaLightSidelight) : 1.0,
        fullscreenOn: res.fullscreenOn != null ? res.fullscreenOn === "true" : false,
        keepScreenOn: res.keepScreenOn != null ? res.keepScreenOn === "true" : false,
        leatherTexture: res.leatherTexture != null ? res.leatherTexture === "true" : false,
        navTopSwipe1: res.navTopSwipe1 ?? "search:Min",
        navTopSwipe2: res.navTopSwipe2 ?? "history:Max",
        navTopDblClick: res.navTopDblClick ?? "meme:Min",
        navTopLongPress: res.navTopLongPress ?? "settings:Mid",
        navBotSwipe1: res.navBotSwipe1 ?? "history:Mid",
        navBotSwipe2: res.navBotSwipe2 ?? "search:Max",
        navBotDblClick: res.navBotDblClick ?? "bookmarks:Min",
        navBotLongPress: res.navBotLongPress ?? "settings:Mid",
      });

      document.documentElement.style.setProperty("--hue", settings.themeHue);
      document.documentElement.style.setProperty("--reader-font-size", settings.fontSize + "rem");
      document.documentElement.style.setProperty("--reader-bg-image", settings.bgImage === "Oakleaf" ? 'url("/oakleafacorn.svg")' : settings.bgImage === "Leaves" ? 'url("/letterLeaf1.svg")' : "none");
    }
  } catch (error) {
    console.error("Failed to load app state:", error);
  } finally {
    triggerRefetch("refetchChapters", "refetchHighlights");
  }
}

// Save all settings to SQLite
export async function saveSettings() {
  try {
    await invoke("set_configs", {
      configs: {
        firstName: String(settings.firstName),
        fontSize: String(settings.fontSize),
        bgImage: String(settings.bgImage),
        themeHue: String(settings.themeHue),
        titleView: String(settings.titleView),
        fullscreenOn: String(settings.fullscreenOn),
        keepScreenOn: String(settings.keepScreenOn),
        leatherTexture: String(settings.leatherTexture),
        sideLightsDark: String(settings.sideLightsDark),
        sideLightsLight: String(settings.sideLightsLight),
        alphaDarkHighlight: String(settings.alphaDarkHighlight),
        alphaDarkSidelight: String(settings.alphaDarkSidelight),
        alphaLightHighlight: String(settings.alphaLightHighlight),
        alphaLightSidelight: String(settings.alphaLightSidelight),
        navTopSwipe1: String(settings.navTopSwipe1),
        navTopSwipe2: String(settings.navTopSwipe2),
        navTopDblClick: String(settings.navTopDblClick),
        navTopLongPress: String(settings.navTopLongPress),
        navBotSwipe1: String(settings.navBotSwipe1),
        navBotSwipe2: String(settings.navBotSwipe2),
        navBotDblClick: String(settings.navBotDblClick),
        navBotLongPress: String(settings.navBotLongPress),
      },
    });
    triggerRefetch("refetchChapters", "refetchHighlights");

    showToast("Settings Saved", "success", 2000, true);
    toggleSheet("settings", "Hid");
  } catch (error) {
    showToast(`Error Saving Settings : ${error}`, "error", 7000, false);
  }
}

// The Load Function (Call this once when the app starts)
// export async function loadSessionState() {
//   try {
//     const keys = ["bible1", "book", "chapterNo", "testamentBtn", "bookBtn", "chapterBtn", "wordHighlight"];
//     const res = await invoke("get_configs", { keys });

//     // Update signals only if the DB has a value, otherwise they keep their defaults
//     if (res.bible1) setBible1(res.bible1);
//     if (res.book) setBook(res.book);
//     if (res.chapterNo) setChapterNo(parseInt(res.chapterNo, 10));
//     if (res.testamentBtn) setTestamentBtn(res.testamentBtn);
//     if (res.bookBtn) setBookBtn(res.bookBtn);
//     if (res.chapterBtn) setChapterBtn(parseInt(res.chapterBtn, 10));
//     if (res.wordHighlight) setWordHighlight(res.wordHighlight != null ? res.wordHighlight === "true" : false);
//   } catch (error) {
//     console.error("Failed to load session state:", error);
//   }
// }

// Use createRoot to provide a top-level owner
createRoot(() => {
  let saveTimeout;

  createEffect(() => {
    // A. Read the signals so SolidJS knows to track them
    const currentBible = bible1();
    const currentBook = book();
    const currentChapter = chapterNo();
    const currentTestamentBtn = testamentBtn();
    const currentBookBtn = bookBtn();
    const currentChapterBtn = chapterBtn();
    const currentWordHighlight = wordHighlight();

    // B. Clear the previous timer if the user is changing chapters rapidly
    clearTimeout(saveTimeout);

    // C. Set a new timer. It will only execute if 1.5 seconds pass without another change
    saveTimeout = setTimeout(async () => {
      try {
        await invoke("set_configs", {
          configs: {
            bible1: String(currentBible),
            book: String(currentBook),
            chapterNo: String(currentChapter),
            testamentBtn: String(currentTestamentBtn),
            bookBtn: String(currentBookBtn),
            chapterBtn: String(currentChapterBtn),
            wordHighlight: String(currentWordHighlight),
          },
        });
        // console.log("Session auto-saved behind the scenes!");
      } catch (error) {
        console.error("Auto-save failed:", error);
      }
    }, 1500); // 1500ms debounce
  });

  createEffect(() => {
    let activeAlpha;

    if (isDarkMode()) {
      activeAlpha = settings.sideLightsDark ? settings.alphaDarkSidelight : settings.alphaDarkHighlight;
    } else {
      activeAlpha = settings.sideLightsLight ? settings.alphaLightSidelight : settings.alphaLightHighlight;
    }

    document.documentElement.style.setProperty("--alpha", activeAlpha);
  });

  // let fullScreenOnFirstRun = true;
  // createEffect(async () => {
  //   console.log(`LOG[:210]: settings.fullScreenOn: `, settings.fullScreenOn);
  //   if (fullScreenOnFirstRun) {
  //     fullScreenOnFirstRun = false;
  //     // Defer to idle so first paint isn't blocked
  //     const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 500));
  //     idle(async () => {
  //       try {
  //         setFullscreen(settings.fullScreenOn);
  //       } catch (err) {
  //         console.error("Failed to set full screen:", err);
  //       }
  //     });
  //     return;
  //   }
  //   try {
  //     setFullscreen(settings.fullScreenOn);
  //   } catch (err) {
  //     console.error("Failed to set full screen:", err);
  //   }
  // });

  let keepScreenOnFirstRun = true;
  createEffect(async () => {
    const shouldWakeLock = settings.keepScreenOn;
    if (keepScreenOnFirstRun) {
      keepScreenOnFirstRun = false;
      // Defer to idle so first paint isn't blocked
      const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 500));
      idle(async () => {
        try {
          await keepScreenOn(shouldWakeLock);
        } catch (err) {
          console.error("Failed to set screen wake lock:", err);
        }
      });
      return;
    }
    try {
      await keepScreenOn(shouldWakeLock);
    } catch (err) {
      console.error("Failed to set screen wake lock:", err);
    }
  });

  let leatherTextureFirstRun = true;
  createEffect(() => {
    const changeTexture = settings.leatherTexture;
    if (leatherTextureFirstRun) {
      leatherTextureFirstRun = false;
      // Defer to idle so first paint isn't blocked
      const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 500));
      idle(async () => {
        try {
          setActivePaper(changeTexture);
        } catch (err) {
          console.error("Failed to change Texture:", err);
        }
      });
      return;
    }
    try {
      setActivePaper(changeTexture);
    } catch (err) {
      console.error("Failed to change Texture:", err);
    }
  });
});

export function handleFontResize(delta = 0) {
  setSettings("fontSize", (size) => {
    /* prettier-ignore */ const fMin = 1.5, fMax = 3;
    return Math.max(fMin, Math.min(fMax, size + delta * 0.1));
  });
}

/**
 * Registers one or more refetch functions.
 * Returns a cleanup function to remove them when the component unmounts.
 */
const refreshers = {};
export function registerRefetchers(obj) {
  for (const [key, func] of Object.entries(obj)) {
    if (!refreshers[key]) {
      refreshers[key] = new Set();
    }
    refreshers[key]?.add(func);
  }

  // Return cleanup function
  return () => {
    for (const [key, func] of Object.entries(obj)) {
      refreshers[key]?.delete(func);
    }
  };
}

/**
 * Allows an array of refreshers
 * triggerRefetch("refetchChapters", "refetchNotes", "refetchTopics", "refetchTopicVerses", "refetchHighlights");
 */
export function triggerRefetch(...keys) {
  keys.forEach((key) => {
    const set = refreshers[key];
    if (set) {
      set.forEach((refetchFn) => {
        if (typeof refetchFn === "function") {
          refetchFn();
        }
      });
    }
  });
}
