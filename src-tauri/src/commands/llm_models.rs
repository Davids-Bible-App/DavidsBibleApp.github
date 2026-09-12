use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

// use crate::commands::bible_llm::DEFAULT_SYSTEM_PROMPT;

use reqwest::header::{ACCEPT_RANGES, CONTENT_RANGE, RANGE};
use std::sync::atomic::{AtomicU64};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

const PARALLEL_CONNECTIONS: u64 = 4;
const MIN_SIZE_FOR_PARALLEL: u64 = 64 * 1024 * 1024; // below this, plain streaming is fine


// ── Paths ──────────────────────────────────────────────────────────────

pub fn llms_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("llms");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_filename(name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid filename.".to_string());
    }
    Ok(name.to_string())
}

// ── settings table (reuses the `settings` table already created in db.rs) ──

pub fn get_setting(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let db_paths = app.state::<crate::models::DbPaths>();
    let conn = rusqlite::Connection::open(&db_paths.profile_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn set_setting(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let db_paths = app.state::<crate::models::DbPaths>();
    let conn = rusqlite::Connection::open(&db_paths.profile_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_setting(app: &AppHandle, key: &str) -> Result<(), String> {
    let db_paths = app.state::<crate::models::DbPaths>();
    let conn = rusqlite::Connection::open(&db_paths.profile_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM settings WHERE key = ?1", rusqlite::params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Local model management ───────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct LocalModelInfo {
    pub filename: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub is_active: bool,
    pub prompt_source: String, // "override" | "file" | "default"
}

#[tauri::command]
pub fn list_local_models(
    app: AppHandle,
    active_state: State<'_, ActiveModelState>,
) -> Result<Vec<LocalModelInfo>, String> {
    let dir = llms_dir(&app)?;
    let active = active_state.0.lock().unwrap().clone();

    // filename -> catalog name, so downloaded models keep their friendly name
    let catalog_names: HashMap<String, String> = read_catalog(&app)?
        .into_iter()
        .map(|c| (c.filename, c.name))
        .collect();

    let mut out = Vec::new();

    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("gguf") {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        let size_bytes = entry.metadata().map_err(|e| e.to_string())?.len();
        let is_active = active.as_deref() == Some(filename.as_str());

        // override > catalog name > raw filename
        let display_name = get_setting(&app, &format!("display_name:{filename}"))?
            .unwrap_or_else(|| {
                catalog_names.get(&filename).cloned().unwrap_or_else(|| filename.clone())
            });

        let prompt_source = if get_setting(&app, &format!("prompt_override:{filename}"))?.is_some() {
            "override"
        } else if crate::commands::bible_llm::prompt_path_for(&path).exists() {
            "file"
        } else {
            "default"
        }
        .to_string();

        out.push(LocalModelInfo { filename, display_name, size_bytes, is_active, prompt_source });
    }
    out.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn select_llm_model(
    app: AppHandle,
    active_state: State<'_, ActiveModelState>,
    filename: String,
) -> Result<(), String> {
    let filename = safe_filename(&filename)?;
    let path = llms_dir(&app)?.join(&filename);
    if !path.exists() {
        return Err(format!("{filename} isn't in your models folder."));
    }

    let path_str = path.to_string_lossy().to_string();
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::bible_llm::load_model_internal(path_str, &app2)
    })
    .await
    .map_err(|e| format!("Load task panicked: {e}"))?;

    match &result {
        Ok(()) => {
            *active_state.0.lock().unwrap() = Some(filename);
            let _ = app.emit("model-ready", ());
        }
        Err(e) => {
            let _ = app.emit("model-error", e.clone());
        }
    }
    result
}

#[tauri::command]
pub async fn probe_download_size(url: String) -> Result<u64, String> {
    let client = reqwest::Client::builder().user_agent("BibleApp/1.0").build().map_err(|e| e.to_string())?;
    let (total, _) = probe_remote(&client, &url).await?;
    Ok(total)
}

// ← NEW: lets the frontend drop the loaded weights from memory without
// picking a replacement model. Clears the "active" pointer too, so a
// restart won't try to reload it (see the app-init note below).
#[tauri::command]
pub fn unload_llm_model(app: AppHandle, active_state: State<'_, ActiveModelState>) -> Result<(), String> {
    crate::commands::bible_llm::unload_model_internal(&app);
    *active_state.0.lock().unwrap() = None;
    let _ = app.emit("model-unloaded", ());
    Ok(())
}

#[tauri::command]
pub fn delete_local_model(app: AppHandle, filename: String) -> Result<(), String> {
    let filename = safe_filename(&filename)?;
    if get_setting(&app, "active_llm_model")?.as_deref() == Some(filename.as_str()) {
        return Err("Switch to a different model before deleting this one.".to_string());
    }
    let path = llms_dir(&app)?.join(&filename);
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    delete_setting(&app, &format!("display_name:{filename}"))?;
    delete_setting(&app, &format!("gpu_layers:{filename}"))?; // ← add this line
    Ok(())
}

// ← Sets the user-facing name only. The file on disk is never touched,
// so prompt overrides, sibling prompt files, and the active-model
// pointer all stay correctly keyed to the real filename.
#[tauri::command]
pub fn set_local_model_display_name(
    app: AppHandle,
    filename: String,
    display_name: String,
) -> Result<(), String> {
    let filename = safe_filename(&filename)?;
    let path = llms_dir(&app)?.join(&filename);
    if !path.exists() {
        return Err(format!("{filename} isn't in your models folder."));
    }

    let display_name = display_name.trim().to_string();
    if display_name.is_empty() {
        return Err("Please enter a name.".to_string());
    }

    set_setting(&app, &format!("display_name:{filename}"), &display_name)?;
    Ok(())
}

#[tauri::command]
pub async fn import_local_model(app: AppHandle, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    let filename = source
        .file_name()
        .ok_or_else(|| "Invalid source file.".to_string())?
        .to_string_lossy()
        .to_string();

    if source.extension().and_then(|e| e.to_str()) != Some("gguf") {
        return Err("Please choose a .gguf file.".to_string());
    }

    // Sanity-check the GGUF magic bytes before committing to a multi-GB copy.
    {
        let mut f = std::fs::File::open(&source).map_err(|e| e.to_string())?;
        let mut magic = [0u8; 4];
        f.read_exact(&mut magic).map_err(|e| e.to_string())?;
        if &magic != b"GGUF" {
            return Err("That file doesn't look like a valid GGUF model.".to_string());
        }
    }

    let dest = llms_dir(&app)?.join(&filename);
    let dest_clone = dest.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::copy(&source, &dest_clone))
        .await
        .map_err(|e| format!("Copy task panicked: {e}"))?
        .map_err(|e| e.to_string())?;

    Ok(filename)
}

// ── Per-model system prompt overrides ───────────────────────────────────
//
// Precedence: settings-table override > sibling `.prompt.txt` file > built-in
// default. Overrides live in the same `settings` key/value table as
// `active_llm_model`, so they travel with your existing profile.db
// export/import flow instead of living in browser storage.

#[derive(Serialize)]
pub struct EffectivePrompt {
    pub prompt: String,
    pub source: String, // "override" | "file" | "default"
}

#[tauri::command]
pub fn get_effective_prompt(app: AppHandle, filename: String) -> Result<EffectivePrompt, String> {
    let filename = safe_filename(&filename)?;
    let key = format!("prompt_override:{filename}");

    if let Some(prompt) = get_setting(&app, &key)? {
        return Ok(EffectivePrompt { prompt, source: "override".to_string() });
    }

    let path = llms_dir(&app)?.join(&filename);
    let prompt_file = crate::commands::bible_llm::prompt_path_for(&path);
    if let Ok(prompt) = std::fs::read_to_string(&prompt_file) {
        return Ok(EffectivePrompt { prompt, source: "file".to_string() });
    }

    Ok(EffectivePrompt {
        prompt: crate::commands::bible_llm::DEFAULT_SYSTEM_PROMPT.to_string(),
        source: "default".to_string(),
    })
}

#[tauri::command]
pub fn set_prompt_override(
    app: AppHandle,
    active_state: State<'_, ActiveModelState>,
    filename: String,
    prompt: String,
) -> Result<(), String> {
    let filename = safe_filename(&filename)?;
    set_setting(&app, &format!("prompt_override:{filename}"), &prompt)?;

    // If this model is the one currently loaded, apply immediately —
    // no need to reload the weights just to change the system prompt.
    if active_state.0.lock().unwrap().as_deref() == Some(filename.as_str()) {
        crate::commands::bible_llm::set_active_system_prompt(&app, &prompt);
    }
    Ok(())
}

#[tauri::command]
pub fn delete_prompt_override(
    app: AppHandle,
    active_state: State<'_, ActiveModelState>,
    filename: String,
) -> Result<(), String> {
    let filename = safe_filename(&filename)?;
    delete_setting(&app, &format!("prompt_override:{filename}"))?;

    if active_state.0.lock().unwrap().as_deref() == Some(filename.as_str()) {
        let path = llms_dir(&app)?.join(&filename);
        let prompt_file = crate::commands::bible_llm::prompt_path_for(&path);
        let restored = std::fs::read_to_string(&prompt_file)
            .unwrap_or_else(|_| crate::commands::bible_llm::DEFAULT_SYSTEM_PROMPT.to_string());
        crate::commands::bible_llm::set_active_system_prompt(&app, &restored);
    }
    Ok(())
}

// ── Catalog (bundled resource file, editable without a server) ──────────

/// Determine the real remote size (and whether ranged downloads are supported)
/// via a 1-byte ranged GET — far more reliable across CDNs than HEAD, which
/// some servers (including some Hugging Face redirect targets) answer with
/// Content-Length: 0. We never read the body, so this costs ~nothing.
async fn probe_remote(client: &reqwest::Client, url: &str) -> Result<(u64, bool), String> {
    let resp = client
        .get(url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach server: {e}"))?;

    let supports_ranges = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;

    let total = resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| resp.content_length())
        .filter(|&n| n > 0);

    match total {
        Some(n) => Ok((n, supports_ranges)),
        None => Err("Server didn't report a size.".to_string()),
    }
}

#[derive(Deserialize)]
struct CatalogFile {
    models: Vec<CatalogEntry>,
}

#[derive(Deserialize, Serialize, Clone)]
struct CatalogEntry {
    id: String,
    name: String,
    filename: String,
    url: String,
    size_bytes: u64,
    #[serde(default)]
    description: String,
    #[serde(default)]
    #[allow(dead_code)]
    sha256: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct CatalogEntryStatus {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub url: String,
    pub size_bytes: u64,
    pub description: String, // ← NEW
    pub downloaded: bool,
}

fn read_bundled_catalog(app: &AppHandle) -> Result<Vec<CatalogEntry>, String> {
    let resource_path = app
        .path()
        .resolve("resources/llm_catalog.json", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&resource_path).map_err(|e| format!("Reading catalog: {e}"))?;
    let catalog: CatalogFile = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(catalog.models)
}

// ← Merges the bundled catalog with any user edits/additions/removals stored
// in the settings table, so `llm_catalog.json` itself never has to be
// rewritten at runtime.
fn read_catalog(app: &AppHandle) -> Result<Vec<CatalogEntry>, String> {
    let bundled = read_bundled_catalog(app)?;

    let db_paths = app.state::<crate::models::DbPaths>();
    let conn = rusqlite::Connection::open(&db_paths.profile_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings WHERE key LIKE 'catalog_override:%' OR key LIKE 'catalog_deleted:%'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut overrides: HashMap<String, CatalogEntry> = HashMap::new();
    let mut deleted: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        if let Some(id) = key.strip_prefix("catalog_override:") {
            if let Ok(entry) = serde_json::from_str::<CatalogEntry>(&value) {
                overrides.insert(id.to_string(), entry);
            }
        } else if let Some(id) = key.strip_prefix("catalog_deleted:") {
            deleted.insert(id.to_string());
        }
    }

    let mut merged = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in bundled {
        if deleted.contains(&entry.id) {
            continue;
        }
        let final_entry = overrides.get(&entry.id).cloned().unwrap_or(entry);
        seen.insert(final_entry.id.clone());
        merged.push(final_entry);
    }

    // Override ids not present in the bundled file are user-added models.
    for (id, entry) in overrides {
        if !seen.contains(&id) && !deleted.contains(&id) {
            merged.push(entry);
        }
    }

    Ok(merged)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntryInput {
    pub id: Option<String>, // None/empty ⇒ create a new entry
    pub name: String,
    pub filename: String,
    pub url: String,
    pub size_bytes: u64,
    pub description: String,
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

#[tauri::command]
pub fn upsert_catalog_entry(app: AppHandle, entry: CatalogEntryInput) -> Result<(), String> {
    let name = entry.name.trim().to_string();
    let filename = entry.filename.trim().to_string();
    let url = entry.url.trim().to_string();
    let description = entry.description.trim().to_string();

    if name.is_empty() {
        return Err("Please enter a name.".to_string());
    }
    if filename.is_empty() || !filename.ends_with(".gguf") {
        return Err("Filename must be a non-empty name ending in .gguf.".to_string());
    }
    let _ = safe_filename(&filename)?; // rejects path separators / traversal
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Please enter a valid http(s) URL.".to_string());
    }
    if entry.size_bytes == 0 {
        return Err("Size must be greater than 0.".to_string());
    }

    let id = match entry.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => id.to_string(),
        None => {
            let existing = read_catalog(&app)?;
            let base = {
                let s = slugify(&name);
                if s.is_empty() { "custom-model".to_string() } else { s }
            };
            let mut candidate = base.clone();
            let mut n = 2;
            while existing.iter().any(|m| m.id == candidate) {
                candidate = format!("{base}-{n}");
                n += 1;
            }
            candidate
        }
    };

    let record = CatalogEntry { id: id.clone(), name, filename, url, size_bytes: entry.size_bytes, description, sha256: None };
    let json = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    set_setting(&app, &format!("catalog_override:{id}"), &json)?;
    delete_setting(&app, &format!("catalog_deleted:{id}"))?; // un-delete if it was previously removed
    Ok(())
}

#[tauri::command]
pub fn delete_catalog_entry(app: AppHandle, id: String) -> Result<(), String> {
    set_setting(&app, &format!("catalog_deleted:{id}"), "1")?;
    delete_setting(&app, &format!("catalog_override:{id}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_llm_catalog(app: AppHandle) -> Result<Vec<CatalogEntryStatus>, String> {
    let dir = llms_dir(&app)?;
    Ok(read_catalog(&app)?
        .into_iter()
        .map(|m| {
            let downloaded = dir.join(&m.filename).exists();
            CatalogEntryStatus {
                id: m.id,
                name: m.name,
                filename: m.filename,
                url: m.url,
                size_bytes: m.size_bytes,
                description: m.description,
                downloaded,
            }
        })
        .collect())
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
}

// ← NEW: tracks an in-flight cancel request per download id so
// `cancel_download` and `download_llm_model` (running on separate command
// invocations) can talk to each other.
pub struct DownloadState {
    cancel_flags: StdMutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DownloadState {
    pub fn new() -> Self {
        Self { cancel_flags: StdMutex::new(HashMap::new()) }
    }
}

// ← Tracks which model (if any) is currently loaded into memory in *this*
// process. Deliberately NOT persisted to the settings table — a fresh
// process always starts with `None`, which is exactly correct since no
// model is auto-loaded on startup. This replaces the old
// `active_llm_model` DB setting for anything meaning "is it loaded now."
pub struct ActiveModelState(pub StdMutex<Option<String>>);

impl ActiveModelState {
    pub fn new() -> Self {
        Self(StdMutex::new(None))
    }
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>, id: String) -> Result<(), String> {
    let flags = state.cancel_flags.lock().unwrap();
    match flags.get(&id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            Ok(())
        }
        None => Err("No active download with that id.".to_string()),
    }
}

#[tauri::command]
pub async fn download_llm_model(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
) -> Result<(), String> {
    let entry = read_catalog(&app)?
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "Unknown model id.".to_string())?;

    let dir = llms_dir(&app)?;
    let final_path = dir.join(&entry.filename);
    let tmp_path = dir.join(format!("{}.part", entry.filename));

    let cancel_flag = Arc::new(AtomicBool::new(false));
    state.cancel_flags.lock().unwrap().insert(id.clone(), cancel_flag.clone());

    struct ForgetOnDrop<'a> { state: &'a DownloadState, id: String }
    impl<'a> Drop for ForgetOnDrop<'a> {
        fn drop(&mut self) {
            self.state.cancel_flags.lock().unwrap().remove(&self.id);
        }
    }
    let _guard = ForgetOnDrop { state: &state, id: id.clone() };

    let client = reqwest::Client::builder()
        .user_agent("BibleApp/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    // Probe with a HEAD so we know the real size and whether ranges are supported,
    // rather than trusting the catalog's cached size_bytes.
    let head = client.head(&entry.url).send().await.map_err(|e| format!("Couldn't reach server: {e}"))?;
    let (total_bytes, _size_is_authoritative) = match probe_remote(&client, &entry.url).await {
        Ok((n, ranges)) => (n, ranges), // ranges flag reused as supports_ranges below
        Err(_) => (entry.size_bytes, false), // couldn't probe — fall back to the catalog's cosmetic estimate
    };    
    let supports_ranges = head
        .headers()
        .get(ACCEPT_RANGES)
        .map(|v| v.as_bytes() == b"bytes")
        .unwrap_or(false);

    let result = if supports_ranges && total_bytes >= MIN_SIZE_FOR_PARALLEL {
        download_parallel(&app, &client, &entry.url, &tmp_path, total_bytes, &id, &cancel_flag).await
    } else {
        download_sequential(&app, &client, &entry.url, &tmp_path, total_bytes, &id, &cancel_flag).await
    };

    match result {
        Ok(()) => {
            std::fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
            let _ = app.emit("download-progress", DownloadProgress { id, downloaded_bytes: total_bytes, total_bytes });
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp_path).await; // covers both cancel and real failure
            if e == "__cancelled__" {
                let _ = app.emit("download-cancelled", id);
                Err("Download cancelled.".to_string())
            } else {
                Err(e)
            }
        }
    }
}

async fn download_parallel(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    tmp_path: &std::path::Path,
    total_bytes: u64,
    id: &str,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    // Pre-allocate so every worker can open its own handle and seek independently.
    {
        let f = std::fs::File::create(tmp_path).map_err(|e| e.to_string())?;
        f.set_len(total_bytes).map_err(|e| e.to_string())?;
    }

    let downloaded = Arc::new(AtomicU64::new(0));
    let chunk_size = total_bytes.div_ceil(PARALLEL_CONNECTIONS);

    // Progress ticker, independent of the workers below.
    let progress_done = Arc::new(AtomicBool::new(false));
    let progress_task = {
        let app = app.clone();
        let id = id.to_string();
        let downloaded = downloaded.clone();
        let progress_done = progress_done.clone();
        tokio::spawn(async move {
            while !progress_done.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                let _ = app.emit(
                    "download-progress",
                    DownloadProgress { id: id.clone(), downloaded_bytes: downloaded.load(Ordering::Relaxed), total_bytes },
                );
            }
        })
    };

    let mut workers = Vec::new();
    for i in 0..PARALLEL_CONNECTIONS {
        let start = i * chunk_size;
        if start >= total_bytes { break; }
        let end = ((start + chunk_size).min(total_bytes)) - 1;

        let client = client.clone();
        let url = url.to_string();
        let tmp_path = tmp_path.to_path_buf();
        let downloaded = downloaded.clone();
        let cancel_flag = cancel_flag.clone();

        workers.push(tokio::spawn(async move {
            let std_file = std::fs::OpenOptions::new().write(true).open(&tmp_path).map_err(|e| e.to_string())?;
            let mut file = tokio::fs::File::from_std(std_file);
            file.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;

            let resp = client
                .get(&url)
                .header(RANGE, format!("bytes={start}-{end}"))
                .send()
                .await
                .map_err(|e| format!("Range request failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("Server returned HTTP {} for a range request", resp.status()));
            }

            use futures_util::StreamExt;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if cancel_flag.load(Ordering::Relaxed) {
                    return Err("__cancelled__".to_string());
                }
                let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                downloaded.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            }
            Ok(())
        }));
    }

    let mut first_err = None;
    for w in workers {
        if let Err(e) = w.await.map_err(|e| e.to_string())? {
            first_err.get_or_insert(e);
        }
    }
    progress_done.store(true, Ordering::Relaxed);
    let _ = progress_task.await;

    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

// Your original single-stream implementation, kept as the fallback path.
async fn download_sequential(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    tmp_path: &std::path::Path,
    total_bytes: u64,
    id: &str,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let response = client.get(url).send().await.map_err(|e| format!("Download failed to start: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    use futures_util::StreamExt;
    let mut file = tokio::fs::File::create(tmp_path).await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("__cancelled__".to_string());
        }
        let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 150 {
            let _ = app.emit("download-progress", DownloadProgress { id: id.to_string(), downloaded_bytes: downloaded, total_bytes });
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_gpu_layers(app: AppHandle, filename: String) -> Result<Option<u32>, String> {
    Ok(get_setting(&app, &format!("gpu_layers:{filename}"))?.and_then(|v| v.parse::<u32>().ok()))
}

#[tauri::command]
pub fn set_gpu_layers(app: AppHandle, filename: String, layers: Option<u32>) -> Result<(), String> {
    match layers {
        Some(n) => set_setting(&app, &format!("gpu_layers:{filename}"), &n.to_string())?,
        None => delete_setting(&app, &format!("gpu_layers:{filename}"))?,
    }
    Ok(())
}