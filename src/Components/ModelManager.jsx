import { createSignal, createEffect, For, Show, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { confirm } from "@tauri-apps/plugin-dialog";
import "./CSS/ModelManager.css";

function CatalogEditorForm(props) {
  return (
    <div class="ModelManager-catalog-editor">
      <label class="ModelManager-catalog-label">
        Name
        <input class="ModelManager-catalog-input" value={props.draft.name} onInput={(e) => props.onChange({ ...props.draft, name: e.currentTarget.value })} />
      </label>
      <label class="ModelManager-catalog-label">
        Filename (.gguf)
        <input class="ModelManager-catalog-input" value={props.draft.filename} onInput={(e) => props.onChange({ ...props.draft, filename: e.currentTarget.value })} />
      </label>
      <label class="ModelManager-catalog-label">
        Download URL
        <input class="ModelManager-catalog-input" value={props.draft.url} onInput={(e) => props.onChange({ ...props.draft, url: e.currentTarget.value })} onBlur={() => props.draft.url.trim() && props.onAutoFillSize()} />{" "}
      </label>
      <label class="ModelManager-catalog-label">
        Size (GB)
        <div class="ModelManager-catalog-url-row">
          <input
            class="ModelManager-catalog-input"
            type="text"
            inputmode="decimal"
            value={props.draft.sizeGb}
            onInput={(e) => {
              const v = e.currentTarget.value;
              if (/^\d*\.?\d*$/.test(v)) props.onChange({ ...props.draft, sizeGb: v });
            }}
          />
          <button type="button" class="ModelManager-btn" disabled={props.autoFillBusy || !props.draft.url.trim()} onClick={props.onAutoFillSize} title="Fetch the exact file size from the URL">
            {props.autoFillBusy ? "…" : "Get size"}
          </button>
        </div>
      </label>
      <label class="ModelManager-catalog-label">
        Description
        <textarea class="ModelManager-catalog-textarea" rows={3} value={props.draft.description} onInput={(e) => props.onChange({ ...props.draft, description: e.currentTarget.value })} />
      </label>
      <div class="ModelManager-prompt-actions">
        <button class="ModelManager-btn" disabled={props.busy} onClick={props.onSave}>
          {props.busy ? "Saving…" : "Save"}
        </button>
        <button class="ModelManager-btn" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
        <Show when={props.onRemove}>
          <button class="ModelManager-btn ModelManager-btn--danger" disabled={props.busy} onClick={props.onRemove}>
            Remove
          </button>
        </Show>
      </div>
    </div>
  );
}

export default function ModelManager(props) {
  const [localModels, setLocalModels] = createSignal([]);
  const [gpuNotice, setGpuNotice] = createSignal(null);
  const [catalog, setCatalog] = createSignal([]);
  const [progress, setProgress] = createSignal({}); // { [id]: { downloaded, total } }
  const [busy, setBusy] = createSignal(null); // filename or catalog id currently in-flight
  const [error, setError] = createSignal(null);

  const [expandedPrompt, setExpandedPrompt] = createSignal(null);
  const [promptDraft, setPromptDraft] = createSignal("");
  const [promptSource, setPromptSource] = createSignal("default");
  const [promptBusy, setPromptBusy] = createSignal(false);

  // ← NEW: inline rename state
  const [renamingFilename, setRenamingFilename] = createSignal(null);
  const [renameDraft, setRenameDraft] = createSignal("");
  const [renameBusy, setRenameBusy] = createSignal(false);

  const [expandedGpu, setExpandedGpu] = createSignal(null);
  const [layerCount, setLayerCount] = createSignal(0);
  const [gpuLayers, setGpuLayers] = createSignal(0);
  const [vramMib, setVramMib] = createSignal(null);
  const [gpuBusy, setGpuBusy] = createSignal(false);
  const [bufferSizes, setBufferSizes] = createSignal({});
  const [gpuCalibration, setGpuCalibration] = createSignal({}); // { [filename]: { layers, mib } }

  const [editingCatalogId, setEditingCatalogId] = createSignal(null); // an id, "__new__", or null
  const [catalogDraft, setCatalogDraft] = createSignal({ name: "", filename: "", url: "", sizeGb: "", description: "" });
  const [catalogBusy, setCatalogBusy] = createSignal(false);
  const [autoFillBusy, setAutoFillBusy] = createSignal(false);

  let unlistenProgress;
  let unlistenCancelled;
  let unlistenGpuFallback;
  let unlistenBufferSize;
  let renameContainerRef;
  let renameInputRef;

  async function refresh() {
    try {
      const [locals, cat] = await Promise.all([invoke("list_local_models"), invoke("get_llm_catalog")]);
      setLocalModels(locals);
      setCatalog(cat);
    } catch (err) {
      console.error("Failed to refresh models:", err);
      setError("Couldn't load model list.");
    }
  }

  onMount(async () => {
    refresh();
    unlistenProgress = await listen("download-progress", (e) => {
      const { id, downloaded_bytes, total_bytes } = e.payload;
      setProgress((prev) => ({ ...prev, [id]: { downloaded: downloaded_bytes, total: total_bytes } }));
    });
    unlistenGpuFallback = await listen("model-gpu-fallback", (e) => {
      setGpuNotice(e.payload);
    });
    // Clear the progress bar promptly when a download is cancelled
    unlistenCancelled = await listen("download-cancelled", (e) => {
      const id = e.payload;
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    unlistenBufferSize = await listen("model-buffer-size", (e) => {
      const [backend, mib] = e.payload;
      setBufferSizes((prev) => ({ ...prev, [backend]: mib }));
      if (!backend.toUpperCase().startsWith("CPU")) {
        const filename = expandedGpu();
        if (filename) {
          setGpuCalibration((prev) => ({ ...prev, [filename]: { layers: gpuLayers(), mib } }));
        }
      }
    });
  });

  onCleanup(() => {
    if (unlistenProgress) unlistenProgress();
    if (unlistenCancelled) unlistenCancelled();
    if (unlistenGpuFallback) unlistenGpuFallback();
    if (unlistenBufferSize) unlistenBufferSize();
  });

  async function handleSelect(filename) {
    setBusy(filename);
    setError(null);
    setGpuNotice(null);
    try {
      await invoke("select_llm_model", { filename });
      await refresh();
    } catch (err) {
      console.error("Failed to select model:", err);
      setError(typeof err === "string" ? err : "Couldn't switch models.");
    } finally {
      setBusy(null);
    }
  }

  // ← NEW
  async function handleUnload() {
    setBusy("__unload__");
    setError(null);
    setGpuNotice(null);
    setExpandedGpu(null);
    try {
      await invoke("unload_llm_model");
      await refresh();
    } catch (err) {
      console.error("Failed to unload model:", err);
      setError(typeof err === "string" ? err : "Couldn't unload the model.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(filename) {
    const sure = await confirm(`Delete ${filename}? This can't be undone.`, {
      title: "Delete model",
      kind: "warning",
    });
    if (!sure) return;

    setBusy(filename);
    setError(null);
    try {
      await invoke("delete_local_model", { filename });
      await refresh();
    } catch (err) {
      console.error("Failed to delete model:", err);
      setError(typeof err === "string" ? err : "Couldn't delete that model.");
    } finally {
      setBusy(null);
    }
  }

  function startRename(filename) {
    setError(null);
    const m = localModels().find((x) => x.filename === filename);
    setRenamingFilename(filename);
    setRenameDraft(m?.display_name ?? filename);
  }

  function cancelRename() {
    setRenamingFilename(null);
  }

  async function confirmRename(filename) {
    const newDisplayName = renameDraft().trim();
    const current = localModels().find((m) => m.filename === filename)?.display_name;
    if (!newDisplayName || newDisplayName === current) {
      setRenamingFilename(null);
      return;
    }
    setRenameBusy(true);
    setError(null);
    try {
      await invoke("set_local_model_display_name", { filename, displayName: newDisplayName });
      setRenamingFilename(null);
      await refresh();
    } catch (err) {
      console.error("Failed to rename model:", err);
      setError(typeof err === "string" ? err : "Couldn't rename that model.");
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleUpload() {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: "GGUF model", extensions: ["gguf"] }],
    });
    if (!selected) return;

    setBusy("__upload__");
    setError(null);
    try {
      await invoke("import_local_model", { sourcePath: selected });
      await refresh();
    } catch (err) {
      console.error("Failed to import model:", err);
      setError(typeof err === "string" ? err : "Couldn't import that file.");
    } finally {
      setBusy(null);
    }
  }

  function startEditCatalog(entry) {
    setError(null);
    setEditingCatalogId(entry.id);
    setCatalogDraft({
      name: entry.name,
      filename: entry.filename,
      url: entry.url,
      sizeGb: (entry.size_bytes / 1e9).toString(),
      description: entry.description || "",
    });
  }

  function startAddCatalog() {
    setError(null);
    setEditingCatalogId("__new__");
    setCatalogDraft({ name: "", filename: "", url: "", sizeGb: "", description: "" });
  }

  function cancelEditCatalog() {
    setEditingCatalogId(null);
  }

  async function saveCatalogEntry() {
    const draft = catalogDraft();
    const sizeBytes = Math.round(parseFloat(draft.sizeGb) * 1e9);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      setError("Enter a valid size in GB.");
      return;
    }
    setCatalogBusy(true);
    setError(null);
    try {
      const id = editingCatalogId() === "__new__" ? null : editingCatalogId();
      await invoke("upsert_catalog_entry", {
        entry: { id, name: draft.name.trim(), filename: draft.filename.trim(), url: draft.url.trim(), sizeBytes, description: draft.description.trim() },
      });
      setEditingCatalogId(null);
      await refresh();
    } catch (err) {
      console.error("Failed to save catalog entry:", err);
      setError(typeof err === "string" ? err : "Couldn't save that model.");
    } finally {
      setCatalogBusy(false);
    }
  }

  async function removeCatalogEntry(id) {
    const sure = await confirm("Remove this model from the catalog?", { title: "Remove model", kind: "warning" });
    if (!sure) return;
    setCatalogBusy(true);
    setError(null);
    try {
      await invoke("delete_catalog_entry", { id });
      setEditingCatalogId(null);
      await refresh();
    } catch (err) {
      console.error("Failed to remove catalog entry:", err);
      setError(typeof err === "string" ? err : "Couldn't remove that model.");
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleDownload(entry) {
    setBusy(entry.id);
    setError(null);
    setProgress((prev) => ({ ...prev, [entry.id]: { downloaded: 0, total: entry.size_bytes } }));
    try {
      await invoke("download_llm_model", { id: entry.id });
      await refresh();
    } catch (err) {
      console.error("Failed to download model:", err);
      const message = typeof err === "string" ? err : "Download failed.";
      if (message !== "Download cancelled.") {
        setError(message);
      }
    } finally {
      setBusy(null);
      setProgress((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    }
  }

  async function handleCancelDownload(id) {
    try {
      await invoke("cancel_download", { id });
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  }

  async function togglePromptEditor(filename) {
    if (expandedPrompt() === filename) {
      setExpandedPrompt(null);
      return;
    }
    setError(null);
    try {
      const effective = await invoke("get_effective_prompt", { filename });
      setPromptDraft(effective.prompt);
      setPromptSource(effective.source);
      setExpandedPrompt(filename);
    } catch (err) {
      console.error("Failed to load prompt:", err);
      setError("Couldn't load the prompt for that model.");
    }
  }

  async function savePrompt(filename) {
    setPromptBusy(true);
    setError(null);
    try {
      await invoke("set_prompt_override", { filename, prompt: promptDraft() });
      setPromptSource("override");
      await refresh();
    } catch (err) {
      console.error("Failed to save prompt:", err);
      setError(typeof err === "string" ? err : "Couldn't save the prompt.");
    } finally {
      setPromptBusy(false);
    }
  }

  async function resetPrompt(filename) {
    setPromptBusy(true);
    setError(null);
    try {
      await invoke("delete_prompt_override", { filename });
      const effective = await invoke("get_effective_prompt", { filename });
      setPromptDraft(effective.prompt);
      setPromptSource(effective.source);
      await refresh();
    } catch (err) {
      console.error("Failed to reset prompt:", err);
      setError(typeof err === "string" ? err : "Couldn't reset the prompt.");
    } finally {
      setPromptBusy(false);
    }
  }

  const promptSourceLabel = () => ({ override: "Custom (saved)", file: "Using the model's default prompt file", default: "Using built-in default" })[promptSource()];

  const formatSize = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

  createEffect(() => {
    const filename = renamingFilename();
    if (!filename) return;

    renameInputRef?.focus();
    renameInputRef?.select();

    const handleOutsideClick = (e) => {
      if (renameContainerRef && !renameContainerRef.contains(e.target)) {
        cancelRename();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick, true);
    onCleanup(() => document.removeEventListener("mousedown", handleOutsideClick, true));
  });

  async function toggleGpuEditor(m) {
    if (expandedGpu() === m.filename) {
      setExpandedGpu(null);
      return;
    }
    setError(null);
    try {
      const modelPath = m.filename;
      const [total, current, vram] = await Promise.all([invoke("get_active_model_layer_count", { filename: m.filename }), invoke("get_gpu_layers", { filename: m.filename }), invoke("get_gpu_vram_mib")]);
      setLayerCount(total);
      setGpuLayers(current ?? 0);
      setVramMib(vram);
      setExpandedGpu(m.filename);
    } catch (err) {
      console.error("Failed to load GPU settings:", err);
      setError(typeof err === "string" ? err : "Couldn't read GPU settings for that model.");
    }
  }

  async function saveGpuLayers(m) {
    setGpuBusy(true);
    setError(null);
    try {
      await invoke("set_gpu_layers", { filename: m.filename, layers: gpuLayers() });
      // Only takes effect on next load — reload now if this model is active.
      if (m.is_active) {
        await invoke("select_llm_model", { filename: m.filename });
        await refresh();
      }
    } catch (err) {
      setError(typeof err === "string" ? err : "Couldn't save GPU layers.");
    } finally {
      setGpuBusy(false);
    }
  }

  const estimatedMib = (m) => {
    const cal = gpuCalibration()[m.filename];
    if (cal && cal.layers > 0) {
      return Math.round((cal.mib / cal.layers) * gpuLayers()); // scaled from a real measurement
    }
    return layerCount() ? Math.round((m.size_bytes / 1e6) * (gpuLayers() / (layerCount() + 1))) : null;
  };

  async function autoFillSize() {
    const url = catalogDraft().url.trim();
    if (!url) return;
    setAutoFillBusy(true);
    setError(null);
    try {
      const bytes = await invoke("probe_download_size", { url });
      const gb = Math.round((bytes / 1e9) * 100) / 100; // round to 2 dp, not truncate
      setCatalogDraft((d) => ({ ...d, sizeGb: gb.toString() }));
    } catch (err) {
      console.error("Failed to probe size:", err);
      setError(typeof err === "string" ? err : "Couldn't fetch that URL's size.");
    } finally {
      setAutoFillBusy(false);
    }
  }

  let urlBlurTimer;
  function onUrlChange(url) {
    props.onChange({ ...props.draft, url });
  }

  return (
    <Show when={props.open}>
      <div class="ModelManager-overlay" onClick={props.onClose}>
        <div class="ModelManager-panel scroll_Win" onClick={(e) => e.stopPropagation()}>
          <div class="ModelManager-header">
            <span>Models</span>
            <button class="ModelManager-close" onClick={props.onClose}>
              ×
            </button>
          </div>

          {error() && <div class="ModelManager-error">{error()}</div>}
          {gpuNotice() && <div class="ModelManager-info">{gpuNotice()}</div>}

          <div class="ModelManager-section-title">Your models</div>
          <Show when={localModels().length > 0} fallback={<div class="ModelManager-empty">No models downloaded yet.</div>}>
            <For each={localModels()}>
              {(m) => (
                <>
                  <div class={`ModelManager-row ${m.is_active ? "ModelManager-row--active" : ""}`}>
                    <div class="ModelManager-row-top">
                      <Show
                        when={renamingFilename() === m.filename}
                        fallback={
                          <span class="ModelManager-row-title ModelManager-row-title--editable" title={`Click to rename · file: ${m.filename}`} onClick={() => !busy() && startRename(m.filename)}>
                            {m.is_active && (
                              <>
                                <span class="ModelManager-badge">&#x2713;</span>&nbsp;
                              </>
                            )}
                            {m.display_name}
                          </span>
                        }
                      >
                        <span ref={renameContainerRef} class="ModelManager-rename-wrap">
                          <input
                            ref={renameInputRef}
                            class="ModelManager-rename-input"
                            value={renameDraft()}
                            onInput={(e) => setRenameDraft(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmRename(m.filename);
                              if (e.key === "Escape") cancelRename();
                            }}
                            autofocus
                          />
                          <button class="ModelManager-rename-confirm" onMouseDown={(e) => e.preventDefault()} disabled={renameBusy()} onClick={() => confirmRename(m.filename)} title="Save name">
                            ✓
                          </button>
                        </span>
                      </Show>
                      <span class="ModelManager-row-size">{formatSize(m.size_bytes)}</span>
                    </div>
                    <div class="ModelManager-row-bottom">
                      <div class="ModelManager-row-badges">
                        <span class={`ModelManager-badge ModelManager-badge--${m.prompt_source}`}>{m.prompt_source === "override" ? "Custom prompt" : m.prompt_source === "file" ? "File prompt" : "Default prompt"}</span>
                      </div>
                      <div class="ModelManager-row-actions">
                        <Show when={!m.is_active}>
                          <button class="ModelManager-btn" disabled={busy() === m.filename} onClick={() => handleSelect(m.filename)}>
                            {busy() === m.filename ? "..." : "Use"}
                          </button>
                        </Show>
                        <Show when={m.is_active}>
                          <button class="ModelManager-btn" disabled={busy() === "__unload__"} onClick={handleUnload}>
                            {busy() === "__unload__" ? "..." : "Unload"}
                          </button>
                        </Show>
                        <button class="ModelManager-btn" onClick={() => togglePromptEditor(m.filename)}>
                          {expandedPrompt() === m.filename ? "Hide prompt" : "Prompt"}
                        </button>
                        <Show when={m.is_active}>
                          <button class="ModelManager-btn" onClick={() => toggleGpuEditor(m)}>
                            {expandedGpu() === m.filename ? "Hide GPU" : "GPU"}
                          </button>
                        </Show>
                        <button class="ModelManager-btn ModelManager-btn--danger" disabled={m.is_active || busy() === m.filename} onClick={() => handleDelete(m.filename)} title={m.is_active ? "Switch models before deleting this one" : "Delete"}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <Show when={expandedPrompt() === m.filename}>
                    <div class="ModelManager-prompt-editor">
                      <div class="ModelManager-prompt-source">{promptSourceLabel()}</div>
                      <textarea class="ModelManager-prompt-textarea" rows={6} value={promptDraft()} onInput={(e) => setPromptDraft(e.currentTarget.value)} />
                      <div class="ModelManager-prompt-actions">
                        <button class="ModelManager-btn" disabled={promptBusy()} onClick={() => savePrompt(m.filename)}>
                          {promptBusy() ? "Saving…" : "Save"}
                        </button>
                        <button class="ModelManager-btn" disabled={promptBusy() || promptSource() !== "override"} onClick={() => resetPrompt(m.filename)} title={promptSource() !== "override" ? "No custom prompt to reset" : "Delete override and go back to the file/default prompt"}>
                          Reset to file/default
                        </button>
                      </div>
                    </div>
                  </Show>
                  <Show when={expandedGpu() === m.filename}>
                    <div class="ModelManager-prompt-editor">
                      <div class="ModelManager-prompt-source">
                        {layerCount()} layers total
                        {vramMib() != null && ` · ~${(vramMib() / 1024).toFixed(1)} GB VRAM detected`}
                      </div>
                      <Show when={layerCount() != null} fallback={<div class="ModelManager-prompt-source">Load this model with "Use" to configure GPU layers.</div>}>
                        <div class="ModelManager-prompt-slider">
                          <input type="range" min="0" max={layerCount()} value={gpuLayers()} onInput={(e) => setGpuLayers(Number(e.currentTarget.value))} style={{ width: "100%" }} />
                        </div>
                        <div class="ModelManager-prompt-source">
                          {gpuLayers()} / {layerCount()} layers on GPU
                          {gpuLayers() === 0 && " (CPU only)"}
                          {estimatedMib(m) != null && ` · ~${(estimatedMib(m) / 1024).toFixed(1)} GB estimated${gpuCalibration()[m.filename] ? " (calibrated)" : " (rough)"}`}{" "}
                          <Show when={Object.keys(bufferSizes()).length > 0}>
                            <div class="ModelManager-prompt-source">
                              <For each={Object.entries(bufferSizes())}>
                                {([backend, mib]) => (
                                  <div>
                                    {backend.toUpperCase().startsWith("CPU") ? "CPU" : "GPU Actual"}: {(mib / 1024).toFixed(2)} GB &nbsp;
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      </Show>
                      <div class="ModelManager-prompt-actions">
                        <button class="ModelManager-btn" disabled={gpuBusy()} onClick={() => saveGpuLayers(m)}>
                          {gpuBusy() ? "Saving…" : m.is_active ? "Save & reload" : "Save"}
                        </button>
                      </div>
                    </div>
                  </Show>
                </>
              )}
            </For>
          </Show>

          <div class="ModelManager-upload-wrap">
            <button class={`ModelManager-upload-btn ${busy() === "__upload__" ? "ModelManager-upload-btn--busy" : ""}`} disabled={busy() === "__upload__"} onClick={handleUpload}>
              {busy() === "__upload__" ? "Importing…" : "+ Upload from device"}
            </button>
          </div>

          <div class="ModelManager-section-title">Available to download</div>
          <Show when={catalog().length > 0} fallback={<div class="ModelManager-empty">No catalog entries found.</div>}>
            <For each={catalog()}>
              {(entry) => (
                <Show when={!entry.downloaded}>
                  <div class="ModelManager-row">
                    <div class="ModelManager-row-top">
                      <span class="ModelManager-row-title" title={entry.description || entry.name}>
                        {entry.name}
                      </span>
                      <span class="ModelManager-row-size">{formatSize(entry.size_bytes)}</span>
                    </div>
                    <Show when={progress()[entry.id]}>
                      <div class="ModelManager-progress-track">
                        <Show when={progress()[entry.id].total > 0} fallback={<div class="ModelManager-progress-fill ModelManager-progress-fill--indeterminate" />}>
                          <div class="ModelManager-progress-fill" style={{ width: `${Math.min(100, (progress()[entry.id].downloaded / progress()[entry.id].total) * 100)}%` }} />
                        </Show>
                      </div>
                    </Show>
                    <div class="ModelManager-row-bottom">
                      <div class="ModelManager-row-actions ModelManager-row-actions--right">
                        <Show
                          when={busy() === entry.id}
                          fallback={
                            <>
                              <button class="ModelManager-btn" onClick={() => handleDownload(entry)}>
                                Download
                              </button>
                              <button class="ModelManager-btn" disabled={catalogBusy()} onClick={() => (editingCatalogId() === entry.id ? cancelEditCatalog() : startEditCatalog(entry))}>
                                {editingCatalogId() === entry.id ? "Close" : "Edit"}
                              </button>
                            </>
                          }
                        >
                          <button class="ModelManager-btn ModelManager-btn--danger" onClick={() => handleCancelDownload(entry.id)}>
                            Cancel
                          </button>
                        </Show>
                      </div>
                    </div>

                    <Show when={editingCatalogId() === entry.id}>
                      <CatalogEditorForm draft={catalogDraft()} onChange={setCatalogDraft} busy={catalogBusy()} autoFillBusy={autoFillBusy()} onAutoFillSize={autoFillSize} onSave={saveCatalogEntry} onCancel={cancelEditCatalog} onRemove={() => removeCatalogEntry(entry.id)} />
                    </Show>
                  </div>
                </Show>
              )}
            </For>
          </Show>

          <Show when={editingCatalogId() === "__new__"}>
            <CatalogEditorForm draft={catalogDraft()} onChange={setCatalogDraft} busy={catalogBusy()} autoFillBusy={autoFillBusy()} onAutoFillSize={autoFillSize} onSave={saveCatalogEntry} onCancel={cancelEditCatalog} />{" "}
          </Show>

          <button class="ModelManager-add-catalog-btn" disabled={catalogBusy()} onClick={() => (editingCatalogId() === "__new__" ? cancelEditCatalog() : startAddCatalog())}>
            {editingCatalogId() === "__new__" ? "Cancel" : "+ Add custom model"}
          </button>
        </div>
      </div>
    </Show>
  );
}
