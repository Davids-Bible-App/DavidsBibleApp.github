import { lazy } from "solid-js";

export const sheetComponents = {
  settings: lazy(() => import("../Components/SettingsPanel")),
  audio: lazy(() => import("../Components/Audio")),
  chat: lazy(() => import("../Components/BibleChat")),
  history: lazy(() => import("../Components/History")),
  meme: lazy(() => import("../Components/MemeMaker")),
  search: lazy(() => import("../Components/SearchRef")),
  crossref: lazy(() => import("../Components/CrossRef")),
  strongs: lazy(() => import("../Components/StrongsVerse")),
  strlook: lazy(() => import("../Components/StrongsLookup")),
  editor: lazy(() => import("../Components/Editor")),
};

export const preloadSheet = (id) => sheetComponents[id]?.preload();
