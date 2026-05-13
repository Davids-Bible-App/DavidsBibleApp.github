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

const copyDbFile = async () => {
  try {
    const source = await open({
      directory: false,
      multiple: false,
      defaultPath: await downloadDir(),
      filters: [
        {
          name: "Database",
          extensions: ["dba", "db"],
        },
      ],
    });

    if (!source) return;

    const sourcePath = typeof source === "string" ? source : source.path;
    const fileName = await basename(sourcePath);

    // We pass the URI and the name to Rust.
    // Rust handles the "content://" vs "C:\" logic automatically.
    await invoke("copy_translation_file", {
      sourceUri: sourcePath,
      fileName: fileName,
    });

    await message(`${fileName} imported successfully!`);
  } catch (err) {
    console.error("Import failed:", err);
    await message(err.toString(), { title: "Error", kind: "error" });
  } finally {
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
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        type="button"
                        class="DbTranslations-iconBtn"
                        onClick={() => deleteFile(item.id + ".dba")}
                      >
                        <svg
                          fill="currentColor"
                          width="15px"
                          height="15px"
                          viewBox="0 0 15 15"
                          version="1.1"
                          id="waste-basket"
                          xmlns="http://www.w3.org/2000/svg"
                        >
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
            <button
              onPointerDown={(e) => e.stopPropagation()}
              class="DbTranslations-uploader"
              type="button"
              onClick={copyDbFile}
            >
              Add Database
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              class="DbTranslations-uploader"
              type="button"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </button>
          </div>
        </content>
      </nav>
    </>
  );
}
