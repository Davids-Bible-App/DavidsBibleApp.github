// src-tauri/src/commands/profile.rs
//
// Bookmark commands — verses stored as JSON text, no per-column fields.
//
// invoke_handler:
//   add_bookmark, rename_bookmark, delete_bookmark, get_bookmarks, reorder_bookmarks

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

fn open_profile(app: &AppHandle) -> Result<Connection, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Connection::open(app_dir.join("profile.db")).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Bookmark {
    pub id:         i64,
    pub title:      String,
    /// JSON array of {tr, bk, ch, vs} objects — parsed on the frontend.
    pub verses:     String,
    pub sort_order: i64,
    pub updated_at: i64,
}

/// Add a bookmark with a JSON verses array.
#[tauri::command]
pub async fn add_bookmark(
    app:    AppHandle,
    title:  String,
    verses: String,   // JSON string from the frontend
) -> Result<i64, String> {
    let conn = open_profile(&app)?;
    conn.execute(
        "INSERT INTO bookmarks (title, verses) VALUES (?1, ?2)",
        params![title, verses],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn rename_bookmark(app: AppHandle, id: i64, title: String) -> Result<(), String> {
    let conn = open_profile(&app)?;
    conn.execute(
        "UPDATE bookmarks SET title = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
        params![title, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_bookmark(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = open_profile(&app)?;
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_bookmarks(app: AppHandle) -> Result<Vec<Bookmark>, String> {
    let conn = open_profile(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, verses, sort_order, updated_at
             FROM bookmarks
             ORDER BY sort_order ASC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| Ok(Bookmark {
            id:         row.get(0)?,
            title:      row.get(1)?,
            verses:     row.get(2)?,
            sort_order: row.get(3)?,
            updated_at: row.get(4)?,
        }))
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for bm in rows { out.push(bm.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub async fn reorder_bookmarks(app: AppHandle, ids: Vec<i64>) -> Result<(), String> {
    let conn = open_profile(&app)?;
    for (pos, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE bookmarks SET sort_order = ?1 WHERE id = ?2",
            params![pos as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn overwrite_bookmark(
    app:    AppHandle,
    id:     i64,
    verses: String,   // title deliberately NOT a parameter
) -> Result<(), String> {
    let conn = open_profile(&app)?;
    conn.execute(
        "UPDATE bookmarks
         SET verses = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![verses, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}