use crate::models::*;
use rusqlite::OptionalExtension;
use rusqlite::{params, params_from_iter, Connection, OpenFlags, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::State;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct MemeTemplate {
    pub id: Option<i64>,
    pub title: String,
    pub thumbnail: String, // Base64 image
    pub payload: String,   // JSON string of the meme state
}

#[derive(Serialize)]
pub struct HistoryEntry {
    translation_id: String,
    book_id: String,
    chapter: u32,
    verse_id: u32,
    updated_at: u64,
}

#[tauri::command]
pub fn log_history_entry(
    app: tauri::AppHandle,
    translation_id: String,
    book_id: String,
    chapter: u32,
    verse_id: u32,
    limit: u32,
) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db");

    let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO read_history (translation_id, book_id, chapter, verse_id, updated_at) 
         VALUES (?1, ?2, ?3, ?4, strftime('%s','now'))
         ON CONFLICT(translation_id, book_id, chapter, verse_id) 
         DO UPDATE SET updated_at = strftime('%s','now')",
        params![translation_id, book_id, chapter, verse_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM read_history 
         WHERE rowid NOT IN (
             SELECT rowid 
             FROM read_history 
             ORDER BY updated_at DESC 
             LIMIT ?1
         )",
        params![limit],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_read_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db");

    let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT translation_id, book_id, chapter, verse_id, updated_at 
         FROM read_history 
         ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let history_iter = stmt
        .query_map([], |row| {
            Ok(HistoryEntry {
                translation_id: row.get(0)?,
                book_id: row.get(1)?,
                chapter: row.get(2)?,
                verse_id: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for entry in history_iter {
        history.push(entry.map_err(|e| e.to_string())?);
    }

    Ok(history)
}

#[tauri::command]
pub fn delete_history_entry(
    app: tauri::AppHandle,
    translation_id: String,
    book_id: String,
    chapter: u32,
    verse_id: u32,
) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db");

    let conn = rusqlite::Connection::open(&profile_path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM read_history 
         WHERE translation_id = ?1 AND book_id = ?2 AND chapter = ?3 AND verse_id = ?4",
        rusqlite::params![translation_id, book_id, chapter, verse_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn clear_all_history(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db");

    let conn = rusqlite::Connection::open(&profile_path).map_err(|e| e.to_string())?;

    // Wipes the entire table
    conn.execute("DELETE FROM read_history", [])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn save_template(
    app_handle: AppHandle,
    title: String,
    thumbnail: String,
    payload: String,
    id: Option<i64>,
) -> Result<i64, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db").to_string_lossy().into_owned();
    let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

    if let Some(existing_id) = id {
        // Update existing template
        conn.execute(
            "UPDATE MemeTemplates SET title = ?1, thumbnail = ?2, payload = ?3, updated_at = strftime('%s','now') WHERE id = ?4",
            params![title, thumbnail, payload, existing_id],
        ).map_err(|e| e.to_string())?;
        Ok(existing_id)
    } else {
        // Insert new template
        conn.execute(
            "INSERT INTO MemeTemplates (title, thumbnail, payload) VALUES (?1, ?2, ?3)",
            params![title, thumbnail, payload],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn get_templates(app_handle: AppHandle) -> Result<Vec<MemeTemplate>, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db").to_string_lossy().into_owned();
    let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, thumbnail, payload FROM MemeTemplates ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let template_iter = stmt
        .query_map([], |row| {
            Ok(MemeTemplate {
                id: row.get(0)?,
                title: row.get(1)?,
                thumbnail: row.get(2)?,
                payload: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut templates = Vec::new();
    for t in template_iter {
        templates.push(t.map_err(|e| e.to_string())?);
    }

    Ok(templates)
}

#[tauri::command]
pub fn delete_template(app_handle: AppHandle, id: i64) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let profile_path = app_dir.join("profile.db").to_string_lossy().into_owned();
    let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM MemeTemplates WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Gallery Specific
#[tauri::command]
pub async fn get_active_filters(
    state: State<'_, DbPaths>,
    entry_type: String,
) -> Result<(Vec<String>, Vec<String>), String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    // Get distinct translations for this specific tab
    let mut trans_stmt = conn
        .prepare(&format!(
            "SELECT DISTINCT translation_id FROM gallery_view_raw WHERE entry_type = '{}'",
            entry_type
        ))
        .map_err(|e| e.to_string())?;

    // Added .map_err here to fix the compilation error
    let trans_list: Vec<String> = trans_stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Get distinct books for this specific tab
    let mut book_stmt = conn
        .prepare(&format!(
            "SELECT DISTINCT book_id FROM gallery_view_raw WHERE entry_type = '{}'",
            entry_type
        ))
        .map_err(|e| e.to_string())?;

    // Added .map_err here to fix the compilation error
    let book_list: Vec<String> = book_stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok((trans_list, book_list))
}

#[tauri::command]
pub async fn get_global_gallery(
    state: State<'_, DbPaths>,
    filter_topic: Option<String>,
    filter_type: Option<String>,
    reset_sort: Option<bool>,
) -> Result<Vec<GalleryEntry>, String> {
    let profile_path = state.profile_path.clone();
    let base_path = state.base_path.join("databases").clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

        // 1. We JOIN the Book table to access englishName and "order"
        let mut sql = "
            SELECT g.entry_type, g.id, g.translation_id, g.book_id, b.englishName, g.chapter, g.verse_id, g.note, g.topic, g.highlight
            FROM gallery_view_raw g
            LEFT JOIN Book b ON g.book_id = b.id
            WHERE 1=1
        ".to_string();

        let mut params = Vec::new();

        if let Some(ref t_type) = filter_type {
            if t_type != "All" {
                sql.push_str(" AND g.entry_type = ?");
                params.push(t_type);
            }
        }

        if let Some(ref t) = filter_topic {
            if !t.is_empty() && t != "All" {
                sql.push_str(" AND g.topic = ?");
                params.push(t);
            }
        }

        // 2. We sort by Biblical order (b."order" ASC) instead of book_id DESC
        let order_by = if reset_sort.unwrap_or(false) {
            " ORDER BY b.\"order\" ASC, g.chapter ASC, g.verse_id ASC"
        } else if filter_type.as_deref() == Some("topic") {
            " ORDER BY g.verse_sort ASC"
        } else {
            " ORDER BY b.\"order\" ASC, g.chapter ASC, g.verse_id ASC"
        };

        sql.push_str(order_by);

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

        // 3. Extract the new row data (note the updated index positions)
        let rows = stmt.query_map(params_from_iter(params), |row| {
            let entry_type: String = row.get(0)?;
            let id: i32 = row.get(1)?;
            let trans_id: String = row.get(2)?;
            let book_id: String = row.get(3)?;
            
            // Grab the full name, default back to the 3-letter ID if it fails for some reason
            let book_name: String = row.get(4).unwrap_or_else(|_| book_id.clone()); 
            
            let chap: i32 = row.get(5)?;
            let verse: i32 = row.get(6)?;
            let user_note: Option<String> = row.get(7)?;
            let user_topic: Option<String> = row.get(8)?;
            let user_highlight: Option<String> = row.get(9)?;

            let bible_path = base_path.join(&trans_id);
            let bible_text = if let Ok(b_conn) = Connection::open_with_flags( 
                &bible_path, OpenFlags::SQLITE_OPEN_READ_ONLY ) {
                b_conn.query_row(
                    "SELECT text FROM chapterVerse WHERE bookId = ?1 AND chapterNumber = ?2 AND number = ?3",
                    [&book_id, &chap.to_string(), &verse.to_string()],
                    |r| r.get(0)
                ).unwrap_or_else(|_| "Translation unavailable".to_string())
            } else {
                "Translation unavailable".to_string()
            };

            Ok(GalleryEntry {
                entry_type,
                id,
                translation_id: trans_id,
                book_id,
                book_name, // Include the new field here!
                chapter: chap,
                verse_id: verse,
                text: bible_text,
                note: user_note,
                topic: user_topic,
                highlight: user_highlight,
            })
        }).map_err(|e| e.to_string())?;

        let mut entries = Vec::new();
        for r in rows { entries.push(r.map_err(|e| e.to_string())?); }
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_gallery_entry(
    state: State<'_, DbPaths>,
    entry_type: String,
    ids: Vec<i32>, // Changed to accept an array of IDs
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }

    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    let table = match entry_type.as_str() {
        "note" => "notes",
        "topic" => "topics",
        "highlight" => "highlights",
        _ => return Err("Invalid type".into()),
    };

    // Use a transaction for fast, safe batch execution
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let sql = format!("DELETE FROM {} WHERE id = ?1", table);
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;

        for id in ids {
            stmt.execute([id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

// Topics Commands
#[tauri::command]
pub async fn rename_topic(
    state: State<'_, DbPaths>,
    old_topic: String,
    new_topic: String,
) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    // Start a transaction so either both update successfully, or neither do
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Update the actual verses grouped under this topic
    tx.execute(
        "UPDATE topics 
         SET topic = ?1, updated_at = strftime('%s','now') 
         WHERE topic = ?2",
        [&new_topic, &old_topic],
    )
    .map_err(|e| e.to_string())?;

    // 2. Update the topic description/metadata (if it exists)
    tx.execute(
        "UPDATE topic_metadata 
         SET topic = ?1, updated_at = strftime('%s','now') 
         WHERE topic = ?2",
        [&new_topic, &old_topic],
    )
    .map_err(|e| e.to_string())?;

    // Commit the changes
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_topic(state: State<'_, DbPaths>, topic: String) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    // Use a transaction to ensure both tables are cleaned up safely
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Delete all verses associated with the topic
    tx.execute(
        "DELETE FROM topics WHERE topic = ?1",
        rusqlite::params![&topic],
    )
    .map_err(|e| e.to_string())?;

    // 2. Delete the topic metadata (description)
    tx.execute(
        "DELETE FROM topic_metadata WHERE topic = ?1",
        rusqlite::params![&topic],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_verses_to_topic(
    state: State<'_, DbPaths>,
    verses: Vec<(String, String, i32, i32)>, // trans, book, chap, verse
    topic: String,
) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Get the current max sort value for this topic to ensure new verses go to the bottom
    let current_max: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(verse_sort), 0) FROM topics WHERE topic = ?1",
            [&topic],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (i, v) in verses.iter().enumerate() {
        let new_sort = current_max + (i as i32) + 1;

        // Use INSERT OR IGNORE to handle the UNIQUE constraint
        tx.execute(
            "INSERT OR IGNORE INTO topics
             (translation_id, book_id, chapter, verse_id, topic, updated_at, verse_sort)
             VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'), ?6)",
            rusqlite::params![&v.0, &v.1, &v.2, &v.3, &topic, new_sort],
        )
        .map_err(|e| e.to_string())?;

        // Update timestamp for the entry if it already existed
        tx.execute(
            "UPDATE topics
             SET updated_at=strftime('%s','now')
             WHERE translation_id=?1 AND book_id=?2 AND chapter=?3 AND verse_id=?4 AND topic=?5",
            [&v.0, &v.1, &v.2.to_string(), &v.3.to_string(), &topic],
        )
        .ok();
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_topics_metadata(
    state: State<'_, DbPaths>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT topic, COUNT(*) as verse_count, MAX(updated_at) as last_updated
         FROM topics
         GROUP BY topic
         ORDER BY topic_sort ASC, MAX(updated_at) DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "topic": row.get::<_, String>(0)?,
                "count": row.get::<_, i32>(1)?,
                "updated": row.get::<_, i64>(2)?
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
pub async fn get_topic_verses(
    state: State<'_, DbPaths>,
    topic: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT translation_id, book_id, chapter, verse_id
         FROM topics
         WHERE topic = ?1
         ORDER BY book_id, chapter, verse_id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([topic], |row| {
            Ok(serde_json::json!({
                "trans": row.get::<_, String>(0)?,
                "book": row.get::<_, String>(1)?,
                "chap": row.get::<_, i32>(2)?,
                "verse": row.get::<_, i32>(3)?
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
pub async fn update_topics_order(
    state: State<'_, DbPaths>,
    ordered_topics: Vec<String>,
) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, topic) in ordered_topics.iter().enumerate() {
        tx.execute(
            "UPDATE topics SET topic_sort = ?1 WHERE topic = ?2",
            rusqlite::params![index as i32, topic],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_verses_order(
    state: State<'_, DbPaths>,
    ordered_ids: Vec<i32>,
) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE topics SET verse_sort = ?1 WHERE id = ?2",
            rusqlite::params![index as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_topic_description(
    state: State<'_, DbPaths>,
    topic: String,
    description: String,
) -> Result<(), String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    // Assuming a table 'topic_metadata' with columns (topic TEXT PRIMARY KEY, description TEXT)
    conn.execute(
        "INSERT INTO topic_metadata (topic, description) 
         VALUES (?1, ?2) 
         ON CONFLICT(topic) DO UPDATE SET description = excluded.description",
        [&topic, &description],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_topic_description(
    state: State<'_, DbPaths>,
    topic: String,
) -> Result<String, String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT description FROM topic_metadata WHERE topic = ?1")
        .map_err(|e| e.to_string())?;

    let res = stmt
        .query_row([topic], |row| row.get(0))
        .unwrap_or_else(|_| "".to_string());
    Ok(res)
}

// Notes & Highlits Commands
#[tauri::command]
pub async fn get_single_note(
    state: State<'_, DbPaths>,
    translation_id: String,
    book_id: String,
    chapter: i32,
    verse: i32,
) -> Result<Option<GalleryEntry>, String> {
    let profile_path = state.profile_path.clone();
    let base_path = state.base_path.join("databases").clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&profile_path).map_err(|e| e.to_string())?;

        // 1. Get the user note data
        let mut stmt = conn.prepare(
            "SELECT entry_type, id, note, topic, highlight 
             FROM gallery_view_raw 
             WHERE translation_id = ?1 AND book_id = ?2 AND chapter = ?3 AND verse_id = ?4 
             LIMIT 1"
        ).map_err(|e| e.to_string())?;

        let note_data = stmt.query_row(
            params![format!("{}.dba", translation_id), book_id, chapter, verse], 
            |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?))
            }
        ).optional().map_err(|e| e.to_string())?;

        // 2. If the note exists, get the Bible text once
        if let Some((entry_type, id, note, topic, highlight)) = note_data {
            let bible_path = base_path.join(format!("{}.dba", translation_id));
            let bible_text = if let Ok(b_conn) = Connection::open_with_flags( 
                &bible_path, OpenFlags::SQLITE_OPEN_READ_ONLY ) {
                b_conn.query_row(
                    "SELECT text FROM chapterVerse WHERE bookId = ?1 AND chapterNumber = ?2 AND number = ?3",
                    [&book_id, &chapter.to_string(), &verse.to_string()],
                    |r| r.get(0)
                ).unwrap_or_else(|_| "Text not found".to_string())
            } else {
                "Translation unavailable".to_string()
            };

            Ok(Some(GalleryEntry {
                entry_type, id, translation_id, book_id, book_name: "".into(), // Add name if needed
                chapter, verse_id: verse, text: bible_text, note, topic, highlight
            }))
        } else {
            Ok(None)
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_note(
    state: State<'_, DbPaths>,
    trans: String,
    book: String,
    chap: u32,
    verse: u32,
    note: String,
) -> Result<(), String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO notes 
         (translation_id, book_id, chapter, verse_id, note, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
         ON CONFLICT(translation_id, book_id, chapter, verse_id)
         DO UPDATE SET 
            note=excluded.note,
            updated_at=strftime('%s','now')",
        params![trans, book, chap, verse, note],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn save_note_by_id(
    state: State<'_, DbPaths>,
    id: i32,
    note: String,
) -> Result<(), String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE notes SET note = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
        rusqlite::params![note, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn toggle_highlight_batch(
    state: State<'_, DbPaths>,
    trans: String,
    book: String,
    chap: i32,
    verses: Vec<i32>,
    color: String,
) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    // Use a transaction for speed and safety
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for v_id in verses {
        if color == "transparent" {
            tx.execute(
                "DELETE FROM highlights 
                 WHERE translation_id=?1 AND book_id=?2 AND chapter=?3 AND verse_id=?4",
                rusqlite::params![trans, book, chap, v_id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO highlights (translation_id, book_id, chapter, verse_id, color, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
                 ON CONFLICT(translation_id, book_id, chapter, verse_id) 
                 DO UPDATE SET color=excluded.color, updated_at=excluded.updated_at",
                rusqlite::params![trans, book, chap, v_id, color],
            ).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// Profile Managing
#[tauri::command]
pub async fn merge_external_profile_db(
    state: State<'_, DbPaths>,
    external_path: String,
) -> Result<String, String> {
    use rusqlite::Connection;

    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    // Attach external DB
    conn.execute(
        &format!(
            "ATTACH DATABASE '{}' AS external",
            external_path.replace("'", "''")
        ),
        [],
    )
    .map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. NOTES: insert missing, then update if external is newer
    tx.execute(
        "
        INSERT OR IGNORE INTO notes
            (translation_id, book_id, chapter, verse_id, note, updated_at)
        SELECT
            translation_id, book_id, chapter, verse_id, note, updated_at
        FROM external.notes;
        ",
        [],
    )
    .ok();

    tx.execute(
        "
        UPDATE notes
        SET
            note = (
                SELECT e.note FROM external.notes e
                WHERE e.translation_id = notes.translation_id AND e.book_id = notes.book_id AND e.chapter = notes.chapter AND e.verse_id = notes.verse_id AND e.updated_at > notes.updated_at
                LIMIT 1
            ),
            updated_at = (
                SELECT e.updated_at FROM external.notes e
                WHERE e.translation_id = notes.translation_id AND e.book_id = notes.book_id AND e.chapter = notes.chapter AND e.verse_id = notes.verse_id AND e.updated_at > notes.updated_at
                LIMIT 1
            )
        WHERE EXISTS (
            SELECT 1 FROM external.notes e
            WHERE e.translation_id = notes.translation_id AND e.book_id = notes.book_id AND e.chapter = notes.chapter AND e.verse_id = notes.verse_id AND e.updated_at > notes.updated_at
        );
        ",
        [],
    ).ok();

    // 2. HIGHLIGHTS: insert missing, then update if external is newer
    tx.execute(
        "
        INSERT OR IGNORE INTO highlights
            (translation_id, book_id, chapter, verse_id, color, updated_at)
        SELECT
            translation_id, book_id, chapter, verse_id, color, updated_at
        FROM external.highlights;
        ",
        [],
    )
    .ok();

    tx.execute(
        "
        UPDATE highlights
        SET
            color = (
                SELECT e.color FROM external.highlights e
                WHERE e.translation_id = highlights.translation_id AND e.book_id = highlights.book_id AND e.chapter = highlights.chapter AND e.verse_id = highlights.verse_id AND e.updated_at > highlights.updated_at
                LIMIT 1
            ),
            updated_at = (
                SELECT e.updated_at FROM external.highlights e
                WHERE e.translation_id = highlights.translation_id AND e.book_id = highlights.book_id AND e.chapter = highlights.chapter AND e.verse_id = highlights.verse_id AND e.updated_at > highlights.updated_at
                LIMIT 1
            )
        WHERE EXISTS (
            SELECT 1 FROM external.highlights e
            WHERE e.translation_id = highlights.translation_id AND e.book_id = highlights.book_id AND e.chapter = highlights.chapter AND e.verse_id = highlights.verse_id AND e.updated_at > highlights.updated_at
        );
        ",
        [],
    ).ok();

    // 3. TOPICS: Additive, including the new sort columns
    tx.execute(
        "
        INSERT OR IGNORE INTO topics
            (translation_id, book_id, chapter, verse_id, topic, topic_sort, verse_sort, updated_at)
        SELECT
            translation_id, book_id, chapter, verse_id, topic, topic_sort, verse_sort, updated_at
        FROM external.topics;
        ",
        [],
    )
    .ok();

    // Sync updated_at and sort orders if external is newer
    tx.execute(
        "
        UPDATE topics
        SET
            topic_sort = (
                SELECT e.topic_sort FROM external.topics e
                WHERE e.translation_id = topics.translation_id AND e.book_id = topics.book_id AND e.chapter = topics.chapter AND e.verse_id = topics.verse_id AND e.topic = topics.topic AND e.updated_at > topics.updated_at
                LIMIT 1
            ),
            verse_sort = (
                SELECT e.verse_sort FROM external.topics e
                WHERE e.translation_id = topics.translation_id AND e.book_id = topics.book_id AND e.chapter = topics.chapter AND e.verse_id = topics.verse_id AND e.topic = topics.topic AND e.updated_at > topics.updated_at
                LIMIT 1
            ),
            updated_at = (
                SELECT e.updated_at FROM external.topics e
                WHERE e.translation_id = topics.translation_id AND e.book_id = topics.book_id AND e.chapter = topics.chapter AND e.verse_id = topics.verse_id AND e.topic = topics.topic AND e.updated_at > topics.updated_at
                LIMIT 1
            )
        WHERE EXISTS (
            SELECT 1 FROM external.topics e
            WHERE e.translation_id = topics.translation_id AND e.book_id = topics.book_id AND e.chapter = topics.chapter AND e.verse_id = topics.verse_id AND e.topic = topics.topic AND e.updated_at > topics.updated_at
        );
        ",
        [],
    ).ok();

    // 4. TOPIC METADATA: Insert missing, update if newer (NEW SECTION)
    tx.execute(
        "
        INSERT OR IGNORE INTO topic_metadata
            (topic, description, updated_at)
        SELECT
            topic, description, updated_at
        FROM external.topic_metadata;
        ",
        [],
    )
    .ok();

    tx.execute(
        "
        UPDATE topic_metadata
        SET
            description = (
                SELECT e.description FROM external.topic_metadata e
                WHERE e.topic = topic_metadata.topic AND e.updated_at > topic_metadata.updated_at
                LIMIT 1
            ),
            updated_at = (
                SELECT e.updated_at FROM external.topic_metadata e
                WHERE e.topic = topic_metadata.topic AND e.updated_at > topic_metadata.updated_at
                LIMIT 1
            )
        WHERE EXISTS (
            SELECT 1 FROM external.topic_metadata e
            WHERE e.topic = topic_metadata.topic AND e.updated_at > topic_metadata.updated_at
        );
        ",
        [],
    )
    .ok();

    // 5. SETTINGS: key/value with updated_at
    tx.execute(
        "
        INSERT OR IGNORE INTO settings
            (key, value, updated_at)
        SELECT key, value, updated_at
        FROM external.settings;
        ",
        [],
    )
    .ok();

    tx.execute(
        "
        UPDATE settings
        SET
            value = (
                SELECT e.value FROM external.settings e
                WHERE e.key = settings.key AND e.updated_at > settings.updated_at
                LIMIT 1
            ),
            updated_at = (
                SELECT e.updated_at FROM external.settings e
                WHERE e.key = settings.key AND e.updated_at > settings.updated_at
                LIMIT 1
            )
        WHERE EXISTS (
            SELECT 1 FROM external.settings e
            WHERE e.key = settings.key AND e.updated_at > settings.updated_at
        );
        ",
        [],
    )
    .ok();

    // 6. HISTORY: additive only
    tx.execute(
        "
        INSERT OR IGNORE INTO search_history (query, timestamp)
        SELECT query, timestamp
        FROM external.search_history;
        ",
        [],
    )
    .ok();

    tx.execute(
        "
        INSERT OR IGNORE INTO context_history (query, timestamp)
        SELECT query, timestamp
        FROM external.context_history;
        ",
        [],
    )
    .ok();

    tx.commit().map_err(|e| e.to_string())?;

    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);", []).ok();

    Ok("TIME STAMPED MERGE COMPLETE".into())
}

#[tauri::command]
pub async fn replace_profile_db(
    state: State<'_, DbPaths>,
    external_path: String,
) -> Result<String, String> {
    // Convert the String to a Path so we can use with_extension
    let profile_path = Path::new(&state.profile_path);
    let backup_path = profile_path.with_extension("db.bak");

    // 2. Create a safety backup
    std::fs::copy(profile_path, &backup_path).map_err(|e| e.to_string())?;

    // 3. Copy the external file over the current profile
    std::fs::copy(&external_path, profile_path).map_err(|e| e.to_string())?;

    Ok("Profile replaced successfully!".into())
}

#[tauri::command]
pub async fn export_profile_db(state: State<'_, DbPaths>) -> Result<Vec<u8>, String> {
    // 1. Force SQLite to move data from the WAL file into the actual .db file
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);", []).ok();

    // 2. Read the profile.db file directly
    fs::read(&state.profile_path).map_err(|e| e.to_string())
}

// Set/Get individual Settings.
#[tauri::command]
pub async fn set_config(
    state: State<'_, DbPaths>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1, ?2, strftime('%s','now'))
         ON CONFLICT(key)
         DO UPDATE SET 
            value = excluded.value,
            updated_at = strftime('%s','now')",
        [key, value],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_config(state: State<'_, DbPaths>, key: String) -> Result<Option<String>, String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let res = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .ok();
    Ok(res)
}

#[tauri::command]
pub async fn set_configs(
    state: State<'_, DbPaths>,
    configs: HashMap<String, String>,
) -> Result<(), String> {
    let mut conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (key, value) in configs {
        tx.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES (?1, ?2, strftime('%s','now'))
             ON CONFLICT(key)
             DO UPDATE SET 
                value = excluded.value,
                updated_at = strftime('%s','now')",
            [key, value],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_configs(
    state: State<'_, DbPaths>,
    keys: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
    let mut results = HashMap::new();

    for key in keys {
        let val: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |r| {
                r.get(0)
            })
            .ok();

        if let Some(v) = val {
            results.insert(key, v);
        }
    }

    Ok(results)
}
