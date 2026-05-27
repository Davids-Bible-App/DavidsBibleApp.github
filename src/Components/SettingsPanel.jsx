import { createSignal, createEffect, onMount, Show, onCleanup } from "solid-js";
import { readFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join, appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { save, open, message, ask } from "@tauri-apps/plugin-dialog";
import { settings, setSettings, loadSettings, saveSettings, triggerRefetch } from "../State/settingsStore.js";
import { isDarkMode, activePaper } from "../State/globalSignals.js";
import "./CSS/SettingsPanel.css";

export default function SettingsPanel(props) {
  onMount(() => {
    queueMicrotask(loadSettings);
  });

  const [localHue, setLocalHue] = createSignal();
  const [fineTune, setFineTune] = createSignal();
  let isDragging = false;

  const decomposeHue = (hue) => {
    const coarse = Math.round(hue / 20) * 20; // e.g. 63 → 60
    const fine = hue - coarse; // e.g. 63 - 60 = +3
    return { coarse: Math.min(360, Math.max(0, coarse)), fine };
  };

  createEffect(() => {
    const saved = settings.themeHue;
    if (!isDragging) {
      const { coarse, fine } = decomposeHue(saved);
      setLocalHue(coarse);
      setFineTune(fine);
    }
  });

  let debounceTimer;
  onCleanup(() => clearTimeout(debounceTimer));

  const clamp = (v) => Math.min(360, Math.max(0, v));

  const applyHue = (coarse, fine) => {
    const effective = clamp(coarse + fine);
    document.documentElement.style.setProperty("--hue", effective);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setSettings("themeHue", effective), 200);
  };

  const handleCoarse = (e) => {
    isDragging = true;
    const h = parseInt(e.target.value);
    setLocalHue(h);
    setFineTune(0);
    applyHue(h, 0);
  };

  const handleCoarseCommit = (e) => {
    clearTimeout(debounceTimer);
    setSettings("themeHue", clamp(parseInt(e.target.value)));
    isDragging = false;
  };

  const handleFine = (e) => {
    isDragging = true;
    const f = parseInt(e.target.value);
    setFineTune(f);
    applyHue(localHue(), f);
  };

  const handleFineCommit = (e) => {
    clearTimeout(debounceTimer);
    setSettings("themeHue", clamp(localHue() + parseInt(e.target.value)));
    isDragging = false;
  };

  const handleImport = async () => {
    try {
      const pickedPath = await open({
        multiple: false,
        filters: [{ name: "Database", extensions: ["db"] }],
      });

      if (!pickedPath) return;

      // --- Android Compatibility Fix Start ---
      // We read the file bytes (Tauri handles the content:// URI internally)
      const fileBytes = await readFile(pickedPath);

      // We save it to the app's internal data directory where Rust has full access
      const tempFileName = "importTemp.db";
      await writeFile(tempFileName, fileBytes, { baseDir: BaseDirectory.AppData });

      // Construct the absolute internal path to pass to Rust
      const appData = await appDataDir();
      const path = await join(appData, tempFileName);
      // --- Android Compatibility Fix End ---

      // We define these as variables so we can use them for both the
      // dialog setup AND the logic check (prevents typos!)
      const LABELS = {
        MERGE: "Merge",
        REPLACE: "Replace",
        CANCEL: "Cancel",
      };

      const choice = await message("Choose how to import this profile:\n\n" + "• Smart Merge: Safely merges notes, highlights, topics, and settings using timestamps.\n" + "• Replace: Overwrites everything with the imported file.", {
        title: "Import Method",
        kind: "info",
        buttons: { yes: LABELS.MERGE, no: LABELS.REPLACE, cancel: LABELS.CANCEL },
      });

      // _LOGIC CHECK: We check the string returned against our labels
      if (choice === LABELS.CANCEL || !choice) return;

      if (choice === LABELS.MERGE) {
        const result = await invoke("merge_external_profile_db", {
          externalPath: path,
          mode: "smart",
        });
        await message(result);
      } else if (choice === LABELS.REPLACE) {
        console.log("Proceeding with REPLACE...");

        // Step 2: If Overwrite, offer a backup
        const wantBackup = await ask("WARNING: Replacing will delete all current notes and history. \n\nWould you like to export a backup of your current data first?", { title: "Confirm Overwrite", kind: "warning" });

        if (wantBackup) {
          const bytes = await invoke("export_profile_db");
          const savePath = await save({ defaultPath: "pre_replace_backup.db" });
          if (savePath) await writeFile(savePath, new Uint8Array(bytes));
        }

        // Step 3: Perform replacement
        const result = await invoke("replace_profile_db", { externalPath: path });
        await message(result);
      }

      // Refresh UI
      triggerRefetch("refetchChapters", "refetchNotes", "refetchTopics", "refetchTopicVerses", "refetchHighlights");
    } catch (err) {
      console.error("Import failed:", err);
      await message(err.toString(), { title: "Import Error", kind: "error" });
    }
  };

  const activeAlphaKey = () => {
    if (isDarkMode()) {
      return settings.sideLightsDark ? "alphaDarkSidelight" : "alphaDarkHighlight";
    } else {
      return settings.sideLightsLight ? "alphaLightSidelight" : "alphaLightHighlight";
    }
  };

  // Helper component to render a consistent row for each gesture preference
  const GestureRow = (rowProps) => {
    // Split the "sheet:size" string
    const getParts = () => settings[rowProps.settingKey].split(":");

    return (
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem;">
        <label style="font-weight: 500;">{rowProps.label}</label>
        <div style="display:flex; gap: 6px;">
          <select class="SettingsPanel-input select-sm" value={getParts()[0]} onInput={(e) => setSettings(rowProps.settingKey, `${e.target.value}:${getParts()[1]}`)}>
            <option value="none">None</option>
            <option value="audio">Audio</option>
            <option value="editor">Editor</option>
            <option value="help">Help</option>
            <option value="history">History</option>
            <option value="meme">Memes</option>
            <option value="search">Search</option>
            <option value="settings">Settings</option>
            <option value="strlook">Strongs</option>
          </select>
          <select class="SettingsPanel-input select-sm" value={getParts()[1]} disabled={getParts()[0] === "none"} onInput={(e) => setSettings(rowProps.settingKey, `${getParts()[0]}:${e.target.value}`)}>
            <option value="Min">Min</option>
            <option value="Mid">Mid</option>
            <option value="Max">Max</option>
          </select>
        </div>
      </div>
    );
  };

  return (
    <div class="SettingsPanel-wrapper">
      <div class="SettingsPanel-container scroll_Win" onClick={(e) => e.stopPropagation()}>
        <h2 class="SettingsPanel-title">Settings</h2>
        <section class="SettingsPanel-header paper" classList={{ paperOverlay: activePaper() }}>
          <button
            class="SettingsPanel-saveBtn bkCol"
            style={
              !activePaper() && {
                background: "linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2)), var(--ThemeBackgrounds0)",
              }
            }
            onClick={() => {
              saveSettings();
            }}
          >
            Save The Changes
          </button>
        </section>

        <div class="SettingsPanel-sections">
          <Show when={!isDarkMode()}>
            <section class="SettingsPanel-section">
              <heading>Light-Mode Theme Tint</heading>
              <div style="width:100%;display:flex;justify-content:center;align-content:center;">
                <group>
                  <label>Hue ({clamp(localHue() + fineTune())}°)</label>

                  {/* Coarse — full spectrum, big steps */}
                  <input type="range" min="0" max="360" step={20} value={localHue()} onInput={handleCoarse} onChange={handleCoarseCommit} />

                  {/* Fine — ±10 trim, resets on coarse move */}
                  <label>
                    Fine ({fineTune() > 0 ? "+" : ""}
                    {fineTune()}°)
                  </label>
                  <input type="range" min="-10" max="10" step={1} value={fineTune()} onInput={handleFine} onChange={handleFineCommit} />
                </group>
              </div>
            </section>
          </Show>

          <section class="SettingsPanel-section">
            <heading>First Letter Image</heading>

            <div style="width:100%;display:flex;justify-content:center;align-content:center;">
              <div style="display:flex;gap:12px;align-items:center;">
                <label>
                  <input
                    type="radio"
                    name="bgChoice"
                    value="none"
                    checked={settings.bgImage === "none"}
                    onInput={() => {
                      setSettings("bgImage", "none");
                      document.documentElement.style.setProperty("--reader-bg-image", "none");
                    }}
                  />
                  &nbsp;None
                </label>

                <label>
                  <input
                    type="radio"
                    name="bgChoice"
                    value="Oakleaf"
                    checked={settings.bgImage === "Oakleaf"}
                    onInput={() => {
                      setSettings("bgImage", "Oakleaf");
                      document.documentElement.style.setProperty("--reader-bg-image", 'url("/oakleafacorn.svg")');
                    }}
                  />
                  &nbsp;Oakleaf
                </label>

                <label>
                  <input
                    type="radio"
                    name="bgChoice"
                    value="Leaves"
                    checked={settings.bgImage === "Leaves"}
                    onInput={() => {
                      setSettings("bgImage", "Leaves");
                      document.documentElement.style.setProperty("--reader-bg-image", 'url("/letterLeaf1.svg")');
                    }}
                  />
                  &nbsp;Leaves
                </label>
              </div>
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Background Texture</heading>
            <center>
              <pre>
                <small>May Impact Performance On Some Devices</small>
              </pre>
            </center>
            <div style="width:100%;display:flex;justify-content:center;align-content:center;">
              <div style="display:flex;gap:12px;align-items:center;">
                <div class="toggle-row">
                  <span class="toggle-state" classList={{ active: !settings.leatherTexture }}>
                    Off
                  </span>
                  <label class="switch">
                    <input type="checkbox" checked={settings.leatherTexture} onChange={(e) => setSettings("leatherTexture", e.target.checked)} />
                    <span class="slider round"></span>
                  </label>
                  <span class="toggle-state" classList={{ active: settings.leatherTexture }}>
                    On
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Reader</heading>
            <div style="width:100%;display:flex;justify-content:center;align-content:center;">
              <group>
                <label>Font Size {settings.fontSize}rem</label>
                <input
                  type="range"
                  min="1.5"
                  max="3"
                  step="0.1"
                  value={settings.fontSize}
                  onInput={(e) => {
                    const v = parseFloat(e.target.value);
                    setSettings("fontSize", v);
                    document.documentElement.style.setProperty("--reader-font-size", v + "rem");
                  }}
                />
              </group>
            </div>

            <button class="SettingsPanel-resetBtn" onClick={() => setSettings("fontSize", 2)}>
              Reset to 2rem
            </button>
          </section>

          <section class="SettingsPanel-section">
            <heading>Highlights or Sidelights</heading>

            <div class="Highlights-container">
              {/* Left Side: The Toggles */}
              <div class="SettingsPanel-toggles">
                {/* Light Mode Toggle */}
                <div class="toggle-row">
                  <span class="toggle-label">Light Mode</span>
                  <span class="toggle-state" classList={{ active: !settings.sideLightsLight }}>
                    Highlights
                  </span>
                  <label class="switch">
                    <input type="checkbox" checked={settings.sideLightsLight} onChange={(e) => setSettings("sideLightsLight", e.target.checked)} />
                    <span class="slider round"></span>
                  </label>
                  <span class="toggle-state" classList={{ active: settings.sideLightsLight }}>
                    Sidelights
                  </span>
                </div>

                {/* Dark Mode Toggle */}
                <div class="toggle-row">
                  <span class="toggle-label">Dark Mode</span>
                  <span class="toggle-state" classList={{ active: !settings.sideLightsDark }}>
                    Highlights
                  </span>
                  <label class="switch">
                    <input type="checkbox" checked={settings.sideLightsDark} onChange={(e) => setSettings("sideLightsDark", e.target.checked)} />
                    <span class="slider round"></span>
                  </label>
                  <span class="toggle-state" classList={{ active: settings.sideLightsDark }}>
                    Sidelights
                  </span>
                </div>
              </div>

              {/* Right Side: The Dynamic Alpha Slider */}
              <div class="Opacity-slider-container">
                <input type="range" class="vertical-range" min="0.2" max="1" step="0.01" value={settings[activeAlphaKey()]} onInput={(e) => setSettings(activeAlphaKey(), parseFloat(e.target.value))} />
                <div class="Opacity-labels">Opacity</div>
              </div>
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Keep Chapter Title InView</heading>

            <div style="width:100%;display:flex;justify-content:center;align-content:center;">
              <div style="display:flex;gap:12px;align-items:center;">
                <label>
                  <input
                    type="radio"
                    name="stickyH"
                    value="false"
                    checked={settings.titleView === false}
                    onInput={() => {
                      setSettings("titleView", false);
                    }}
                  />
                  &nbsp;No
                </label>

                <label>
                  <input
                    type="radio"
                    name="stickyH"
                    value="true"
                    checked={settings.titleView === true}
                    onInput={() => {
                      setSettings("titleView", true);
                    }}
                  />
                  &nbsp;Yes
                </label>
              </div>
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Keep Screen On</heading>
            <div style="width:100%;display:flex;justify-content:center;align-content:center;">
              <div style="display:flex;gap:12px;align-items:center;">
                <div class="toggle-row">
                  <span class="toggle-state" classList={{ active: !settings.keepScreenOn }}>
                    Off
                  </span>
                  <label class="switch">
                    <input type="checkbox" checked={settings.keepScreenOn} onChange={(e) => setSettings("keepScreenOn", e.target.checked)} />
                    <span class="slider round"></span>
                  </label>
                  <span class="toggle-state" classList={{ active: settings.keepScreenOn }}>
                    On
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Top Navigation Bar Gestures</heading>
            <div style="width:100%; display:flex; flex-direction:column; padding-top: 0.5rem;">
              <GestureRow label="1 Finger Swipe" settingKey="navTopSwipe1" />
              <GestureRow label="2 Finger Swipe" settingKey="navTopSwipe2" />
              <GestureRow label="Double Click" settingKey="navTopDblClick" />
              <GestureRow label="Long Press" settingKey="navTopLongPress" />
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Bottom Navigation Bar Gestures</heading>
            <div style="width:100%; display:flex; flex-direction:column; padding-top: 0.5rem;">
              <GestureRow label="1 Finger Swipe" settingKey="navBotSwipe1" />
              <GestureRow label="2 Finger Swipe" settingKey="navBotSwipe2" />
              <GestureRow label="Double Click" settingKey="navBotDblClick" />
              <GestureRow label="Long Press" settingKey="navBotLongPress" />
            </div>
          </section>

          <section class="SettingsPanel-section">
            <heading>Personalise</heading>
            <div style="width:100%;display:flex;justify-content:center;align-content:center;">
              <label>First Name</label>
            </div>
            <input class="SettingsPanel-input" value={settings.firstName} onInput={(e) => setSettings("firstName", e.target.value)} />
          </section>

          <section class="SettingsPanel-section">
            <heading>Export / Import</heading>

            <button class="SettingsPanel-actionBtn" onClick={handleImport}>
              Import / Merge
            </button>
            <button
              class="SettingsPanel-actionBtn"
              onClick={async () => {
                try {
                  const bytes = await invoke("export_profile_db");
                  const path = await save({
                    defaultPath: "study_backup.db",
                    filters: [{ name: "SQLite Database", extensions: ["db"] }],
                  });

                  if (path) {
                    await writeFile(path, new Uint8Array(bytes));
                    await message("Backup exported successfully!", { title: "Export", kind: "success" });
                  }
                } catch (err) {
                  console.error(err);
                }
              }}
            >
              Export Profile
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
