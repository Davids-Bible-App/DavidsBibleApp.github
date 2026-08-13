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

/// Pre-processes user search input into a flexible, fuzzy FTS5 query.
/// Example: "grace mercy love" -> '"grace mercy love" OR (grace* OR mercy* OR love*)'
fn prepare_fts5_fuzzy_query(input: &str) -> String {
    // 1. Strip special FTS operator chars to prevent syntax errors
    let clean: String = input
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();

    let terms: Vec<&str> = clean.split_whitespace().collect();

    if terms.is_empty() {
        return String::new();
    }

    if terms.len() == 1 {
        // Single term: use prefix search (e.g., "grac" -> "grac*")
        format!("{}*", terms[0])
    } else {
        // Multiple terms:
        // Highest boost: Exact phrase match ("grace mercy love")
        // Fallback: Word-by-word prefix OR match (grace* OR mercy* OR love*)
        let exact_phrase = terms.join(" ");
        let or_terms = terms
            .iter()
            .map(|t| format!("{}*", t))
            .collect::<Vec<_>>()
            .join(" OR ");

        format!("\"{}\" OR ({})", exact_phrase, or_terms)
    }
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

    // Build the fuzzy query instead of wrapping in literal quotes
    let fuzzy_query = prepare_fts5_fuzzy_query(trimmed);
    if fuzzy_query.is_empty() {
        return Ok(UnifiedResult::Keyword(SearchResponse {
            hits: vec![],
            total_count: 0,
        }));
    }

    let keyword_results = fts5_search_all_selected(
        state,
        fuzzy_query,
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

    let start_tag = "<mark>";
    let end_tag = "</mark>";

    let first_path = state.base_path.join("databases").join(&targets[0]);
    let conn = Connection::open_with_flags(first_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let text_selection = if highlight_on {
        format!(
            "highlight(chapterVerse_fts, 0, '{}', '{}')",
            start_tag, end_tag
        )
    } else {
        "cv.text".to_string()
    };

    // --- Data query: bm25()/highlight() live in the top-level SELECT of each
    // UNION ALL branch. ORDER BY/LIMIT/OFFSET are appended directly to the
    // compound statement (no outer wrapping SELECT), since bm25() breaks once
    // it's nested under another query.
    let mut union_sql = format!(
        "SELECT '{}' as trans, cv.bookId, cv.chapterNumber, cv.number, {}, b.\"order\" as book_order, bm25(chapterVerse_fts) as score
        FROM chapterVerse cv
        JOIN chapterVerse_fts fts ON cv.rowid = fts.rowid
        JOIN Book b ON cv.bookId = b.id
        WHERE fts.text MATCH ?1 {}",
        targets[0], text_selection, scope_filter
    );

    // --- Count query: a separate, minimal version with no bm25()/highlight(),
    // safe to wrap in COUNT(*) FROM (...) since it doesn't use FTS5 aux functions.
    let mut count_union_sql = format!(
        "SELECT 1
         FROM chapterVerse cv
         JOIN chapterVerse_fts fts ON cv.rowid = fts.rowid
         JOIN Book b ON cv.bookId = b.id
         WHERE fts.text MATCH ?1 {}",
        scope_filter
    );

    for (i, name) in targets.iter().enumerate().skip(1) {
        let alias = format!("db{}", i);
        let path = state.base_path.join("databases").join(name);
        conn.execute(
            &format!("ATTACH DATABASE '{}' AS {}", path.to_string_lossy(), alias),
            [],
        )
        .ok();

        union_sql.push_str(&format!(
            " UNION ALL SELECT '{}', cv.bookId, cv.chapterNumber, cv.number, {}, b.\"order\", bm25(chapterVerse_fts) as score
            FROM {}.chapterVerse cv
            JOIN {}.chapterVerse_fts fts ON cv.rowid = fts.rowid
            JOIN {}.Book b ON cv.bookId = b.id
            WHERE fts.text MATCH ?1 {}",
            name, text_selection, alias, alias, alias, scope_filter
        ));

        count_union_sql.push_str(&format!(
            " UNION ALL SELECT 1
            FROM {}.chapterVerse cv
            JOIN {}.chapterVerse_fts fts ON cv.rowid = fts.rowid
            JOIN {}.Book b ON cv.bookId = b.id
            WHERE fts.text MATCH ?1 {}",
            alias, alias, alias, scope_filter
        ));
    }

    // --- 2. COUNT (safe: no bm25/highlight inside) ---
    let count_sql = format!("SELECT COUNT(*) FROM ({})", count_union_sql);
    let total_count: u32 = conn
        .query_row(&count_sql, [&query], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    // --- 3. RESULTS: ORDER BY / LIMIT / OFFSET appended directly to the
    // UNION ALL — no outer wrapping SELECT around bm25()/highlight().
    let final_sql = format!(
        "{} ORDER BY score ASC, book_order ASC, chapterNumber ASC, number ASC LIMIT {} OFFSET {}",
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
            })
        })
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for r in rows {
        hits.push(r.map_err(|e| e.to_string())?);
    }

    Ok(SearchResponse { hits, total_count })
}