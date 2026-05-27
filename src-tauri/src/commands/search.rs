use crate::commands::context::parse_bible_reference;
use crate::models::*;
use rusqlite::{Connection, OpenFlags, Result};
use tauri::State;

fn looks_like_reference(q: &str) -> bool {
    let q = q.trim();

    if q.contains(':') || q.contains('-') || q.contains(',') {
        return true;
    }

    // Detect patterns like ".1" or ".12"
    let re = regex::Regex::new(r"\.[0-9]").unwrap();
    if re.is_match(q) {
        return true;
    }

    false
}

#[tauri::command]
pub async fn unified_search(
    state: State<'_, DbPaths>,
    query: String,
    targets: Vec<String>,
    scope: String,
    page: i32,
    per_page: i32,
    highlight_on: bool,
) -> Result<UnifiedResult, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Query is empty".into());
    }

    if looks_like_reference(trimmed) {
        let verses =
            parse_bible_reference(state.clone(), trimmed.to_string(), targets[0].clone()).await?;
        if !verses.is_empty() {
            return Ok(UnifiedResult::Reference(verses));
        }
    }

    // FALLBACK: Escape the query for FTS5 to prevent "no such column" errors
    // Wrapping in double quotes tells FTS5 "this is one literal string"
    let escaped_query = format!("\"{}\"", trimmed.replace("\"", ""));

    let keyword_results = fts5_search_all_selected(
        state,
        escaped_query,
        targets,
        scope,
        page,
        per_page,
        highlight_on,
    )
    .await?;

    Ok(UnifiedResult::Keyword(keyword_results))
}

#[tauri::command]
pub async fn fts5_search_all_selected(
    state: State<'_, DbPaths>,
    query: String,
    targets: Vec<String>,
    scope: String,
    page: i32,
    per_page: i32,
    highlight_on: bool,
) -> Result<SearchResponse, String> {
    if targets.is_empty() {
        return Ok(SearchResponse {
            hits: vec![],
            total_count: 0,
        });
    }

    let offset = page * per_page;
    let scope_filter = match scope.as_str() {
        "OT" => "AND b.\"order\" < 40",
        "NT" => "AND b.\"order\" >= 40",
        _ => "",
    };

    // Prepare our tags for the highlight function
    let start_tag = format!(
    "<mark>"
  );
    let end_tag = "</mark>";

    let first_path = state.base_path.join("databases").join(&targets[0]);
    let conn = Connection::open_with_flags(first_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    // --- 1. BUILD THE SQL FRAGMENT ---
    let text_selection = if highlight_on {
        format!(
            "highlight(chapterVerse_fts, 0, '{}', '{}')",
            start_tag, end_tag
        )
    } else {
        "cv.text".to_string()
    };

    // ADDED: b."order" as book_order to the SELECT statement
    let mut union_sql = format!(
      "SELECT '{}' as trans, cv.bookId, cv.chapterNumber, cv.number, {}, b.\"order\" as book_order
       FROM chapterVerse cv
       JOIN chapterVerse_fts fts ON cv.rowid = fts.rowid
       JOIN Book b ON cv.bookId = b.id
       WHERE fts.text MATCH ?1 {}",
      targets[0], text_selection, scope_filter
  );

    for (i, name) in targets.iter().enumerate().skip(1) {
        let alias = format!("db{}", i);
        let path = state.base_path.join("databases").join(name);
        conn.execute(
            &format!("ATTACH DATABASE '{}' AS {}", path.to_string_lossy(), alias),
            [],
        )
        .ok();

        // ADDED: b."order" to the UNION SELECT statement
        union_sql.push_str(&format!(
            " UNION ALL SELECT '{}', cv.bookId, cv.chapterNumber, cv.number, {}, b.\"order\"
            FROM {}.chapterVerse cv
            JOIN {}.chapterVerse_fts fts ON cv.rowid = fts.rowid
            JOIN {}.Book b ON cv.bookId = b.id
            WHERE fts.text MATCH ?1 {}",
            name, text_selection, alias, alias, alias, scope_filter
        ));
    }

    // --- 2. EXECUTE ---
    let count_sql = format!("SELECT COUNT(*) FROM ({})", union_sql);
    let total_count: u32 = conn
        .query_row(&count_sql, [&query], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    // ADDED: ORDER BY clause sorting sequentially by Book order -> Chapter -> Verse
    let final_sql = format!(
      "SELECT * FROM ({}) ORDER BY book_order ASC, chapterNumber ASC, number ASC LIMIT {} OFFSET {}", 
      union_sql, per_page, offset
  );

    let mut stmt = conn.prepare(&final_sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&query], |row| {
            Ok(SearchHit {
                translation: row.get(0)?,
                book_id: row.get(1)?,
                chapter: row.get(2)?,
                verse: row.get(3)?,
                text: row.get(4)?,
                // Note: row.get(5) would be book_order, but we safely ignore it here
                // because it's only needed for the SQL sorting step.
            })
        })
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for r in rows {
        hits.push(r.map_err(|e| e.to_string())?);
    }

    Ok(SearchResponse { hits, total_count })
}

// #[tauri::command]
// pub async fn fts5_search_all_selected(
//     state: State<'_, DbPaths>,
//     query: String,
//     targets: Vec<String>,
//     scope: String,
//     page: i32,
//     per_page: i32,
//     highlight_on: bool,
//     highlight_color: String, // e.g., "#ffcc00" or "yellow or var(--color)"
// ) -> Result<SearchResponse, String> {
//     if targets.is_empty() { return Ok(SearchResponse { hits: vec![], total_count: 0 }); }

//     let offset = page * per_page;
//     let scope_filter = match scope.as_str() {
//         "OT" => "AND b.\"order\" < 40",
//         "NT" => "AND b.\"order\" >= 40",
//         _ => ""
//     };

//     // Prepare our tags for the highlight function
//     let start_tag = format!(
//       "<mark style=\"background-color: {}; color: var(--text-color-inverted); border-radius: 5px; padding: 0 2px;\">",
//       highlight_color
//     );
//     let end_tag = "</mark>";

//     let first_path = state.base_path.join("databases").join(&targets[0]);
//     let conn = Connection::open_with_flags(
//     first_path,
//     OpenFlags::SQLITE_OPEN_READ_ONLY
//     ).map_err(|e| e.to_string())?;

//     // --- 1. BUILD THE SQL FRAGMENT ---
//     // If highlight_on is true, we use highlight(), otherwise we use raw text
//     let text_selection = if highlight_on {
//         format!("highlight(chapterVerse_fts, 0, '{}', '{}')", start_tag, end_tag)
//     } else {
//         "cv.text".to_string()
//     };

//     let mut union_sql = format!(
//         "SELECT '{}' as trans, cv.bookId, cv.chapterNumber, cv.number, {}
//          FROM chapterVerse cv
//          JOIN chapterVerse_fts fts ON cv.rowid = fts.rowid
//          JOIN Book b ON cv.bookId = b.id
//          WHERE fts.text MATCH ?1 {}",
//         targets[0], text_selection, scope_filter
//     );

//     for (i, name) in targets.iter().enumerate().skip(1) {
//         let alias = format!("db{}", i);
//         let path = state.base_path.join("databases").join(name);
//         conn.execute(&format!("ATTACH DATABASE '{}' AS {}", path.to_string_lossy(), alias), []).ok();

//         union_sql.push_str(&format!(
//             " UNION ALL SELECT '{}', cv.bookId, cv.chapterNumber, cv.number, {}
//               FROM {}.chapterVerse cv
//               JOIN {}.chapterVerse_fts fts ON cv.rowid = fts.rowid
//               JOIN {}.Book b ON cv.bookId = b.id
//               WHERE fts.text MATCH ?1 {}",
//             name, text_selection, alias, alias, alias, scope_filter
//         ));
//     }

//     // --- 2. EXECUTE ---
//     let count_sql = format!("SELECT COUNT(*) FROM ({})", union_sql);
//     let total_count: u32 = conn.query_row(&count_sql, [&query], |r| r.get(0)).map_err(|e| e.to_string())?;

//     let final_sql = format!("SELECT * FROM ({}) LIMIT {} OFFSET {}", union_sql, per_page, offset);
//     let mut stmt = conn.prepare(&final_sql).map_err(|e| e.to_string())?;

//     let rows = stmt.query_map([&query], |row| {
//         Ok(SearchHit {
//             translation: row.get(0)?,
//             book_id: row.get(1)?,
//             chapter: row.get(2)?,
//             verse: row.get(3)?,
//             text: row.get(4)?, // This will now contain the <mark> tags if toggled
//         })
//     }).map_err(|e| e.to_string())?;

//     let mut hits = Vec::new();
//     for r in rows { hits.push(r.map_err(|e| e.to_string())?); }

//     Ok(SearchResponse { hits, total_count })
// }

// #[tauri::command]
// pub async fn delete_search_history_item(state: State<'_, DbPaths>, query: String) -> Result<(), String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     conn.execute("DELETE FROM search_history WHERE query = ?1", [query])
//         .map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[tauri::command]
// pub async fn clear_all_search_history(state: State<'_, DbPaths>) -> Result<(), String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     conn.execute("DELETE FROM search_history", []).map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[tauri::command]
// pub async fn save_search_query(state: State<'_, DbPaths>, query: String) -> Result<(), String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     // INSERT OR REPLACE updates the timestamp if the query already exists
//     conn.execute(
//         "INSERT OR REPLACE INTO search_history (query) VALUES (?1)",
//         [&query],
//     ).map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[tauri::command]
// pub async fn get_search_history(state: State<'_, DbPaths>) -> Result<Vec<String>, String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     let mut stmt = conn.prepare("SELECT query FROM search_history ORDER BY timestamp DESC LIMIT 10")
//         .map_err(|e| e.to_string())?;

//     let rows = stmt.query_map([], |row| row.get(0))
//         .map_err(|e| e.to_string())?;

//     let mut history = Vec::new();
//     for r in rows { history.push(r.map_err(|e| e.to_string())?); }
//     Ok(history)
// }
