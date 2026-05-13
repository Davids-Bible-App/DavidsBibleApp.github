import { createSignal } from "solid-js";

// Data-Flow
export const [bible1, setBible1] = createSignal("eng_kjv");
export const [book, setBook] = createSignal("JHN");
export const [chapterNo, setChapterNo] = createSignal(1);
export const [targetVerse, setTargetVerse] = createSignal(null);
export const [chapterBtn, setChapterBtn] = createSignal(1);
export const [testamentBtn, setTestamentBtn] = createSignal("nt");
export const [bookOrderNo, setBookOrderNo] = createSignal();
export const [bible2, setBible2] = createSignal("eng_kjv");
export const [bibleVersion, setBibleVersion] = createSignal("eng_kjv");
export const [bookBtn, setBookBtn] = createSignal("John");
export const [numberOfChapters, setNumberOfChapters] = createSignal();
export const [activeCrossRef, setActiveCrossRef] = createSignal(null);
export const [isSecondaryVisible, setSecondaryVisible] = createSignal(false);
export const [keepInView, setKeepInView] = createSignal(true);

// ================================================================================

// Passing sripture to the Mememaker Text Layer
export const [injectedVerse, setInjectedVerse] = createSignal();
// DbTranslations expanded state
export const [expanded, setExpanded] = createSignal(false);
// Audio Controls Show/Hide
export const [expandAudio, setExpandAudio] = createSignal(false);
// ControlBox expanded state
export const [expandedCtl, setExpandedCtl] = createSignal(0);
// "left", "", "right"
export const [trigger, setTrigger] = createSignal("");
// To return from or enter a Topic Item
export const [selectedTopic, setSelectedTopic] = createSignal(null);
// To Save New Topic Name
export const [topicController, setTopicController] = createSignal(false);
// Verse Selection Array -- Do Something
export const [selection, setSelection] = createSignal([]);
// Search Word Highlight
export const [wordHighlight, setWordHighlight] = createSignal(true);
// CompareVerse Dropdown
export const [showSelection, setShowSelection] = createSignal(false);
// Note Modal and contents
export const [activeNoteVerse, setActiveNoteVerse] = createSignal(null);
// PaperOverlay Class Trig
export const [activePaper, setActivePaper] = createSignal(false);

// ================================================================================

// SSR Check (prevents crashes if using SolidStart/Server-Side Rendering)
const isBrowser = typeof window !== "undefined";
const media = isBrowser ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const [isDarkMode, setIsDarkMode] = createSignal(media ? media.matches : false);

if (media) {
  media.addEventListener("change", (e) => setIsDarkMode(e.matches));
}

export { isDarkMode };

// ================================================================================
