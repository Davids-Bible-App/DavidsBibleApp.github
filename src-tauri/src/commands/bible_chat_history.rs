use rusqlite::{params, Connection};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::commands::bible_llm::ChatTurn;

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// NOTE: if you already have a shared connection helper in db.rs, use that
/// instead of opening a fresh connection here.
fn open_conn(app: &AppHandle) -> Result<Connection, String> {
    let db_paths = app.state::<crate::models::DbPaths>();
    Connection::open(&db_paths.profile_path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ConversationSummary {
    pub id: i64,
    pub title: String,
    pub updated_at: i64,
}

#[tauri::command]
pub fn list_bible_conversations(app: AppHandle) -> Result<Vec<ConversationSummary>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, title, updated_at FROM bible_chat_conversations ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_bible_conversation_messages(app: AppHandle, id: i64) -> Result<Vec<ChatTurn>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT role, content FROM bible_chat_messages WHERE conversation_id = ?1 ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id], |row| {
            Ok(ChatTurn {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_bible_conversation(app: AppHandle) -> Result<i64, String> {
    let conn = open_conn(&app)?;
    let ts = now_ts();
    conn.execute(
        "INSERT INTO bible_chat_conversations (title, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params!["New conversation", ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn delete_bible_conversation(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = open_conn(&app)?;
    conn.execute(
        "DELETE FROM bible_chat_messages WHERE conversation_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM bible_chat_conversations WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn append_bible_message(
    app: AppHandle,
    conversation_id: i64,
    role: String,
    content: String,
) -> Result<(), String> {
    let conn = open_conn(&app)?;
    let ts = now_ts();
    conn.execute(
        "INSERT INTO bible_chat_messages (conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![conversation_id, role, content, ts],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE bible_chat_conversations SET updated_at = ?1 WHERE id = ?2",
        params![ts, conversation_id],
    )
    .map_err(|e| e.to_string())?;

    // Auto-title the conversation from its first user message.
    if role == "user" {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bible_chat_messages WHERE conversation_id = ?1 AND role = 'user'",
                params![conversation_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count == 1 {
            let title: String = content.chars().take(40).collect();
            conn.execute(
                "UPDATE bible_chat_conversations SET title = ?1 WHERE id = ?2",
                params![title, conversation_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}