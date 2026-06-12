// src/State/fullscreen.js
import { createSignal } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";

const [isFullscreen, _setIsFullscreen] = createSignal(false);
const appWindow = getCurrentWindow();

let _platform = null;
const getPlatform = async () => {
  if (!_platform) _platform = await platform();
  return _platform;
};

// Helper to keep SolidJS signal and HTML class perfectly in sync
const updateFullscreenState = (value) => {
  _setIsFullscreen(value);
  if (value) {
    document.documentElement.classList.add("is-fullscreen");
  } else {
    document.documentElement.classList.remove("is-fullscreen");
  }
};

export { isFullscreen };

export const setFullscreen = async (value) => {
  const p = await getPlatform();
  try {
    if (p === "android") {
      if (window.AndroidFullscreen) {
        if (value) {
          window.AndroidFullscreen.enterFullscreen();
        } else {
          window.AndroidFullscreen.exitFullscreen();
        }
        updateFullscreenState(value);
      }
    } else {
      await appWindow.setFullscreen(value);
      updateFullscreenState(value);
    }
  } catch (e) {
    console.warn("[fullscreen] Failed to alter fullscreen state:", e);
  }
};

export const toggleFullscreen = async () => {
  await setFullscreen(!isFullscreen());
};

export const initFullscreen = async () => {
  const p = await getPlatform();
  if (p === "android") {
    updateFullscreenState(false);
  } else {
    try {
      updateFullscreenState(await appWindow.isFullscreen());
    } catch {}
    try {
      await appWindow.onResized(async () => {
        try {
          updateFullscreenState(await appWindow.isFullscreen());
        } catch {}
      });
    } catch {}
  }
};
