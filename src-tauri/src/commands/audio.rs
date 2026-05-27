use async_trait::async_trait;
use std::sync::Arc;
use tauri::{Runtime, Emitter, State};
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};
use tauri_plugin_background_service::{BackgroundService, ServiceContext, ServiceError};

use std::fs;
use std::io;
// use std::path::PathBuf;
// use tauri::{AppHandle, Url, Manager}; 
use tauri::{AppHandle, Manager}; 
// use tauri_plugin_fs::FsExt;
use serde::Serialize;
use alphanumeric_sort;

// ─── Sleep-Timer Background Service ──────────────────────────────────────

#[derive(Default, Clone)]
pub struct TimerState {
    pub deadline: Arc<Mutex<Option<Instant>>>,
    pub remaining_on_pause: Arc<Mutex<Option<Duration>>>,
}

pub struct MyService {
    state: TimerState,
}

impl MyService {
    pub fn new(state: TimerState) -> Self {
        Self { state }
    }
}

#[async_trait]
impl<R: Runtime> BackgroundService<R> for MyService {
    async fn init(&mut self, _ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        Ok(())
    }

    async fn run(&mut self, ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        let mut interval = tokio::time::interval(Duration::from_secs(1));

        loop {
            tokio::select! {
                _ = ctx.shutdown.cancelled() => break,
                _ = interval.tick() => {
                    let deadline_opt = {
                        let guard = self.state.deadline.lock().await;
                        *guard
                    };

                    if let Some(deadline) = deadline_opt {
                        let now = Instant::now();
                        if now >= deadline {
                            {
                                let mut guard = self.state.deadline.lock().await;
                                *guard = None;
                            }
                            let _ = ctx.app.emit("my-service://timer-done", ());
                        } else {
                            let remaining = deadline.saturating_duration_since(now).as_secs();
                            let _ = ctx.app.emit("my-service://timer-tick", remaining);
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

// ─── Timer Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn timer_start(seconds: u64, state: State<'_, TimerState>) -> Result<(), String> {
    let mut guard = state.deadline.lock().await;
    *guard = Some(Instant::now() + Duration::from_secs(seconds));
    let mut paused = state.remaining_on_pause.lock().await;
    *paused = None;
    Ok(())
}

#[tauri::command]
pub async fn timer_pause(state: State<'_, TimerState>) -> Result<u64, String> {
    let mut guard = state.deadline.lock().await;
    if let Some(deadline) = *guard {
        let remaining = deadline.saturating_duration_since(Instant::now());
        *guard = None;
        let mut paused = state.remaining_on_pause.lock().await;
        *paused = Some(remaining);
        Ok(remaining.as_secs())
    } else {
        Ok(0)
    }
}

#[tauri::command]
pub async fn timer_resume(state: State<'_, TimerState>) -> Result<u64, String> {
    let mut paused = state.remaining_on_pause.lock().await;
    if let Some(remaining) = paused.take() {
        let mut guard = state.deadline.lock().await;
        *guard = Some(Instant::now() + remaining);
        Ok(remaining.as_secs())
    } else {
        Ok(0)
    }
}

#[tauri::command]
pub async fn timer_cancel(state: State<'_, TimerState>) -> Result<(), String> {
    let mut guard = state.deadline.lock().await;
    *guard = None;
    let mut paused = state.remaining_on_pause.lock().await;
    *paused = None;
    Ok(())
}

#[tauri::command]
pub async fn timer_get_remaining(state: State<'_, TimerState>) -> Result<u64, String> {
    let guard = state.deadline.lock().await;
    if let Some(deadline) = *guard {
        Ok(deadline.saturating_duration_since(Instant::now()).as_secs())
    } else {
        let paused = state.remaining_on_pause.lock().await;
        Ok(paused.map(|d| d.as_secs()).unwrap_or(0))
    }
}

// Define the data structure we will send to the frontend
#[derive(Clone, Serialize)]
struct ProgressPayload {
    progress: f64,
}

#[tauri::command]
pub async fn import_audio_zip<R: Runtime>(
    app: AppHandle<R>,
    source_uri: String,
) -> Result<String, String> {

    // ✅ Immediately signal that we've started — JS bar moves right away
    let _ = app.emit("import-progress", ProgressPayload { progress: 0.0 });

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = read_uri(&app, &source_uri)?;

    // ✅ Byte-reading done — nudge to ~5% so user sees movement during zip parse
    let _ = app.emit("import-progress", ProgressPayload { progress: 5.0 });

    // Open archive in memory to find the author name first
    let cursor = std::io::Cursor::new(&bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Invalid zip: {}", e))?;

    // Try _meta.txt first, then fall back to content URI / path stem
    let author = read_meta_from_archive(&mut archive)
        .or_else(|| resolve_author_from_uri(&source_uri))
        .ok_or("Could not determine author name. Add a _meta.txt to your zip.")?;

    let author = author.trim().trim_end_matches(".zip").to_string();
    if author.is_empty() {
        return Err("Author name is empty.".to_string());
    }

    let target_base = app_dir.join("audio").join(&author);
    let total_files = archive.len();

    for i in 0..total_files {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;

        // Skip the meta file — don't extract it
        if file.name() == "_meta.txt" {
            continue;
        }

        let outpath = match file.enclosed_name() {
            Some(path) => target_base.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }

        let percent = 5.0 + (i as f64 / total_files as f64) * 95.0;
        let _ = app.emit("import-progress", ProgressPayload { progress: percent });
    }

    let _ = app.emit("import-progress", ProgressPayload { progress: 100.0 });

    Ok(author)
}

//* --- import_audio_zip Helpers ---
fn read_meta_from_archive(archive: &mut zip::ZipArchive<std::io::Cursor<&Vec<u8>>>) -> Option<String> {
    let mut meta_file = archive.by_name("_meta.txt").ok()?;
    let mut content = String::new();
    io::Read::read_to_string(&mut meta_file, &mut content).ok()?;
    let name = content.trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

fn resolve_author_from_uri(uri: &str) -> Option<String> {
    // Works for normal file paths; Android content:// URIs will return the garbled name
    let stem = uri.split('/').last()?
        .split('\\').last()?
        .trim_end_matches(".zip")
        .to_string();
    if stem.is_empty() || stem.starts_with("msf") { None } else { Some(stem) }
}

fn read_uri<R: tauri::Runtime>(app: &tauri::AppHandle<R>, source_uri: &str) -> Result<Vec<u8>, String> {
    use tauri_plugin_fs::FsExt;
    if source_uri.starts_with("content://") || source_uri.starts_with("file://") {
        let url = tauri::Url::parse(source_uri).map_err(|e| e.to_string())?;
        app.fs().read(url).map_err(|e| e.to_string())
    } else {
        fs::read(source_uri).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn delete_author<R: Runtime>(
    app: AppHandle<R>,
    author: String,
) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let author_dir = app_dir.join("audio").join(&author);

    if author_dir.exists() {
        fs::remove_dir_all(&author_dir)
            .map_err(|e| format!("Failed to delete author folder: {}", e))?;
    } else {
        return Err(format!("Author '{}' not found.", author));
    }

    Ok(())
}

#[tauri::command]
pub fn get_available_authors<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let audio_dir = app_dir.join("audio");

    // If the audio directory doesn't exist yet, return an empty list
    if !audio_dir.exists() {
        return Ok(vec![]);
    }

    let mut authors = Vec::new();
    let entries = fs::read_dir(audio_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            if let Ok(file_type) = entry.file_type() {
                // We only care about directories (the author folders)
                if file_type.is_dir() {
                    if let Ok(name) = entry.file_name().into_string() {
                        authors.push(name);
                    }
                }
            }
        }
    }

    Ok(authors)
}

#[tauri::command]
pub async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist(folder_path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    
    let paths = std::fs::read_dir(folder_path).map_err(|e| e.to_string())?;

    for path in paths {
        if let Ok(entry) = path {
            let p = entry.path();
            if p.is_file() && p.extension().map_or(false, |ext| ext == "mp3" || ext == "m4a") {
                files.push(p.to_string_lossy().into_owned());
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn get_book_playlist(folder_path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let path = std::path::Path::new(&folder_path);

    if !path.exists() {
        return Err("Folder not found".into());
    }

    let paths = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in paths {
        if let Ok(entry) = entry {
            let p = entry.path();
            if p.is_file() {
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
                if ext == "m4a" || ext == "mp3" {
                    files.push(p.to_string_lossy().into_owned());
                }
            }
        }
    }
    
    // Sort naturally so Chapter 2 comes before Chapter 10
    files.sort_by(|a, b| alphanumeric_sort::compare_str(a, b));
    Ok(files)
}