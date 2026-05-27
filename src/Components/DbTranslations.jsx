import { createSignal, createEffect, For, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open, ask, message } from "@tauri-apps/plugin-dialog";
import { closeAllSheets } from "../State/sheetStore";
import { basename, appDataDir, downloadDir } from "@tauri-apps/api/path";
import { type } from "@tauri-apps/plugin-os";
import "./CSS/DbTranslations.css";
import { setBible1, setBible2, expanded, setExpanded } from "../State/globalSignals.js";

const [files, setFiles] = createSignal([]);
const dbDir = (await appDataDir()) + "/databases/";

const loadFiles = async () => {
  try {
    const result = await invoke("get_available_translations");
    setFiles(result);
  } catch (e) {
    console.error("Error listing files:", e);
  }
};

const deleteFile = async (filename) => {
  try {
    const confirmed = await ask(`Delete ${filename}?`, {
      title: "Confirm Deletion",
      kind: "warning", // "info" | "warning" | "error"
    });

    if (!confirmed) {
      console.log("User cancelled");
      return;
    }

    await invoke("delete_db_file", { dir: dbDir, filename });
    setFiles(files().filter((f) => f !== filename));
  } catch (e) {
    console.error("Error deleting file:", e);
  }
};

// const copyDbFile = async () => {
//   try {
//     const sources = await open({
//       directory: false,
//       multiple: true, // ← allow multi-select
//       defaultPath: await downloadDir(),
//       filters: [{ name: "Database", extensions: ["dba", "db"] }],
//     });

//     if (!sources || sources.length === 0) return;

//     // Normalise: `open` returns a string when multiple:false,
//     // but an array of { path } objects when multiple:true on some targets.
//     const files = await Promise.all(
//       (Array.isArray(sources) ? sources : [sources]).map(async (s) => {
//         const sourceUri = typeof s === "string" ? s : s.path;
//         const fileName = await basename(sourceUri);
//         return { sourceUri, fileName };
//       }),
//     );

//     await invoke("copy_translation_files", { files }); // ← plural command

//     const names = files.map((f) => f.fileName).join(", ");
//     await message(`${files.length} file(s) imported:\n${names}`);
//   } catch (err) {
//     console.error("Import failed:", err);
//     await message(err.toString(), { title: "Error", kind: "error" });
//   } finally {
//     loadFiles();
//   }
// };

// Signals — add alongside your existing ones
const [isImporting, setIsImporting] = createSignal(false);
const [importProgress, setImportProgress] = createSignal(0);

const copyDbFile = async () => {
  try {
    const sources = await open({
      directory: false,
      multiple: true,
      defaultPath: await downloadDir(),
      filters: [{ name: "Database", extensions: ["dba", "db"] }],
    });

    if (!sources || sources.length === 0) return;

    const files = await Promise.all(
      (Array.isArray(sources) ? sources : [sources]).map(async (s) => {
        const sourceUri = typeof s === "string" ? s : s.path;
        const fileName = await basename(sourceUri);
        return { sourceUri, fileName };
      }),
    );

    // Lock UI and reset progress before starting
    setIsImporting(true);
    setImportProgress(0);

    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const { sourceUri, fileName } = files[i];

      try {
        await invoke("copy_translation_file", { sourceUri, fileName });
      } catch (err) {
        errors.push(`${fileName}: ${err}`);
      }

      // Progress reflects files completed so far
      setImportProgress(((i + 1) / files.length) * 100);
    }

    if (errors.length > 0) {
      await message(errors.join("\n"), { title: "Some imports failed", kind: "error" });
    } else {
      const names = files.map((f) => f.fileName).join(", ");
      await message(`${files.length} file(s) imported:\n${names}`);
    }
  } catch (err) {
    console.error("Import failed:", err);
    await message(err.toString(), { title: "Error", kind: "error" });
  } finally {
    setIsImporting(false); // ← unlocks UI regardless of outcome
    setImportProgress(0);
    loadFiles();
  }
};

export default function DbTranslations(props) {
  const [winScroll, setWinScroll] = createSignal(false);
  onMount(() => {
    loadFiles();
    setWinScroll(type() === "windows");
  });
  const [currentTranslations, setCurrentTranslations] = createSignal([]);

  createEffect(async () => {
    if (props.translations.state === "ready") {
      // 1. The array of IDs you want to match against
      const availableDBs = files();

      // 2. The original array of objects you want to filter
      const allTranslations = props.translations();

      // 3. Create a new array containing only matching objects
      const resultingTranslations = await allTranslations.filter((translation) => {
        // Check if the current object's 'id' exists within the 'availableDBs' array
        return availableDBs.includes(translation.id + ".dba");
      });

      setCurrentTranslations(resultingTranslations);
    }
  });

  createEffect(() => {
    expanded() && closeAllSheets();
  });
  return (
    <>
      <nav class="DbTranslations-nav">
        <content style={expanded() ? "height: 20rem; " : "height: 0; "}>
          <div>
            <h4>{files().length} Translations</h4>
            <div class="DbTranslations-listWrap" classList={{ scroll_Win: winScroll() }}>
              <ul>
                <For each={currentTranslations()} fallback={<div>No items</div>}>
                  {(item) => (
                    <li class="DbTranslations-listItem">
                      <span
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          props.pane() === 2 ? setBible2(item.id) : setBible1(item.id);
                          setExpanded(false);
                        }}
                      >
                        {item.english_name}&nbsp
                      </span>
                      <button onPointerDown={(e) => e.stopPropagation()} type="button" class="DbTranslations-iconBtn" onClick={() => deleteFile(item.id + ".dba")}>
                        <svg fill="currentColor" width="15px" height="15px" viewBox="0 0 15 15" version="1.1" id="waste-basket" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M12.41,5.58l-1.34,8c-0.0433,0.2368-0.2493,0.4091-0.49,0.41H4.42c-0.2407-0.0009-0.4467-0.1732-0.49-0.41l-1.34-8&#xA;&#x9;C2.5458,5.3074,2.731,5.0506,3.0035,5.0064C3.0288,5.0023,3.0544,5.0002,3.08,5h8.83c0.2761-0.0036,0.5028,0.2174,0.5064,0.4935&#xA;&#x9;C12.4168,5.5225,12.4146,5.5514,12.41,5.58z M13,3.5C13,3.7761,12.7761,4,12.5,4h-10C2.2239,4,2,3.7761,2,3.5S2.2239,3,2.5,3H5V1.5&#xA;&#x9;C5,1.2239,5.2239,1,5.5,1h4C9.7761,1,10,1.2239,10,1.5V3h2.5C12.7761,3,13,3.2239,13,3.5z M9,3V2H6v1H9z"
                          />
                        </svg>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
          <div class="DbTranslations-uploadCancelWrap">
            <button onPointerDown={(e) => e.stopPropagation()} class="DbTranslations-uploader" type="button" onClick={copyDbFile}>
              Add Database
            </button>
            <button onPointerDown={(e) => e.stopPropagation()} class="DbTranslations-uploader" type="button" onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </content>
        <Portal>
          <Show when={isImporting()}>
            <div class="Import-modal-overlay">
              <div class="Import-modal-content">
                <h3>Copying Files...</h3>
                <p>Please be patient while we import your files. This may take a minute.</p>

                <div class="Progress-bar-container">
                  <div class="Progress-bar-fill" style={{ width: `${importProgress()}%` }}></div>
                </div>

                <p class="Progress-text">{Math.round(importProgress())}% Complete</p>
              </div>
            </div>
          </Show>
        </Portal>
      </nav>
    </>
  );
}
