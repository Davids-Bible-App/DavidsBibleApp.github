use std::fs;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn save_meme_image<R: Runtime>(
    app: AppHandle<R>,
    bytes: Vec<u8>,
    filename: String,
) -> Result<String, String> {
    // 1. Get the AppData directory
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_dir = app_dir.join("memes");

    // 2. Create the "memes" folder if it doesn't exist
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    // 3. Save the file
    let target_path = target_dir.join(&filename);
    fs::write(target_path, bytes).map_err(|e| e.to_string())?;

    // Return just the filename, we reconstruct the path on the frontend
    Ok(filename)
}

#[tauri::command]
pub fn delete_meme_image<R: Runtime>(app: AppHandle<R>, filename: String) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_path = app_dir.join("memes").join(&filename);

    if target_path.exists() {
        fs::remove_file(&target_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}
