import { closeAllSheets } from "./sheetStore";
import {
  setExpanded,
  setExpandedCtl,
  setTrigger,
  setSelectedTopic,
  setShowSelection,
  setActiveNoteVerse,
} from "./globalSignals.js";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { exit } from "@tauri-apps/plugin-process";
import { type } from "@tauri-apps/plugin-os";
import { triggerHaptic } from "../lib/functions.js";

// 1. Setup variables for double-tap-to-exit
let lastBackPress = 0;
const DOUBLE_TAP_DELAY = 300;

const handleCloseRequest = () => {
  closeAllSheets(); // Top/Bottom Sheets
  setExpandedCtl(0); // Controlbox
  setExpanded(false); // DbTranslations
  setSelectedTopic(null); // Topic List Item
  setShowSelection(false); // Compare Verses
  setTrigger(""); // Left/Right Slidebars
  setActiveNoteVerse(null); // Note Modal
};

// 2. Desktop: Escape Key (Always safe to register)
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    handleCloseRequest();
  }
});

// 3. Android: Back Button (ONLY register if on android)
const setupMobileBack = async () => {
  try {
    const platform = type();
    if (platform === "android") {
      await onBackButtonPress((event) => {
        const handled = handleCloseRequest();
        triggerHaptic("soft");

        if (!handled) {
          const now = Date.now();

          // If the time between now and the last press is less than the delay, exit.
          if (now - lastBackPress < DOUBLE_TAP_DELAY) {
            exit(0); // Tauri v2 exit
          } else {
            // Otherwise, just log the time of this press. No toast.
            lastBackPress = now;
          }
        }
      });
    }
  } catch (e) {
    console.error("Failed to initialize back button:", e);
  }
};

setupMobileBack();
