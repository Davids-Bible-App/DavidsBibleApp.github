use crate::models::*;
use rusqlite::{Connection, OpenFlags, Result, ToSql};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use tauri::State;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, Url};
use tauri_plugin_fs::FsExt;
use regex::Regex; // Add `regex = "1"` to your Cargo.toml dependencies

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrongsDef {
    pub strongs_id: String,
    pub lemma: Option<String>,
    pub transliteration: Option<String>,
    pub pronunciation: Option<String>,
    pub kjv_def: Option<String>,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseUsage {
    pub book_id: String,
    pub chapter_number: i32,
    pub verse_number: i32,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupResponse {
    pub dictionaries: Vec<StrongsDef>, // Changed to Vec to support multiple results
    pub verses: Vec<VerseUsage>,
    pub search_type: String, // "strongs" or "english"
}

#[tauri::command]
pub fn lookup_strongs(
    state: tauri::State<'_, DbPaths>,
    query: String,
) -> Result<LookupResponse, String> {
    let trans_path = state.base_path.join("databases").join("strongs_kjv.db");
    let conn = Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let query = query.trim();
    
    // Check if the query is a Strong's number (e.g., G746, H1254)
    let strongs_regex = Regex::new(r"^[GHgh]\d{1,4}$").unwrap();
    let is_strongs = strongs_regex.is_match(query);

    let mut dictionaries = Vec::new();
    let mut verses = Vec::new();

    if is_strongs {
        let exact_code = query.to_uppercase();
        let like_pattern = format!("%{}%", exact_code);

        // 1. Get Single Dictionary Definition
        let mut def_stmt = conn.prepare(
            "SELECT strongs, lemma, transliteration, pronunciation, kjv_def, definition 
             FROM StrongsDefinition WHERE strongs = ?1 LIMIT 1"
        ).map_err(|e| e.to_string())?;

        let dict_iter = def_stmt.query_map(rusqlite::params![exact_code], |row| {
            Ok(StrongsDef {
                strongs_id: row.get(0)?, lemma: row.get(1)?, transliteration: row.get(2)?,
                pronunciation: row.get(3)?, kjv_def: row.get(4)?, definition: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        for d in dict_iter { dictionaries.push(d.map_err(|e| e.to_string())?); }

        // 2. Get Verses by Strongs Code
        let mut verse_stmt = conn.prepare(
            "SELECT cv.bookId, cv.chapterNumber, cv.verseNumber, cv.text
             FROM VerseWord vw JOIN ChapterVerse cv ON vw.verseId = cv.id
             WHERE vw.strongs LIKE ?1 LIMIT 200;"
        ).map_err(|e| e.to_string())?;

        let verse_iter = verse_stmt.query_map(rusqlite::params![like_pattern], |row| {
            Ok(VerseUsage {
                book_id: row.get(0)?, chapter_number: row.get(1)?,
                verse_number: row.get(2)?, text: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;

        for v in verse_iter { verses.push(v.map_err(|e| e.to_string())?); }

        Ok(LookupResponse { dictionaries, verses, search_type: "strongs".to_string() })

    } else {
        // ENGLISH WORD SEARCH
        let like_pattern = format!("%{}%", query);

        // 1. Get Multiple Dictionary Definitions where the translation contains the word
        let mut def_stmt = conn.prepare(
            "SELECT strongs, lemma, transliteration, pronunciation, kjv_def, definition 
             FROM StrongsDefinition WHERE kjv_def LIKE ?1 LIMIT 20" // Limiting to top 20 matches
        ).map_err(|e| e.to_string())?;

        let dict_iter = def_stmt.query_map(rusqlite::params![like_pattern], |row| {
            Ok(StrongsDef {
                strongs_id: row.get(0)?, lemma: row.get(1)?, transliteration: row.get(2)?,
                pronunciation: row.get(3)?, kjv_def: row.get(4)?, definition: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        for d in dict_iter { dictionaries.push(d.map_err(|e| e.to_string())?); }

        // 2. Get Verses containing the exact English word (case insensitive)
        let mut verse_stmt = conn.prepare(
            "SELECT cv.bookId, cv.chapterNumber, cv.verseNumber, cv.text
             FROM VerseWord vw JOIN ChapterVerse cv ON vw.verseId = cv.id
             WHERE vw.text COLLATE NOCASE = ?1 LIMIT 200;"
        ).map_err(|e| e.to_string())?;

        let verse_iter = verse_stmt.query_map(rusqlite::params![query], |row| {
            Ok(VerseUsage {
                book_id: row.get(0)?, chapter_number: row.get(1)?,
                verse_number: row.get(2)?, text: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;

        for v in verse_iter { verses.push(v.map_err(|e| e.to_string())?); }

        Ok(LookupResponse { dictionaries, verses, search_type: "english".to_string() })
    }
}

#[derive(Deserialize, Debug)]
pub struct CrossRefQuery {
    pub ref_id: String, // We'll pass the full string here (e.g., "1JN.1.1-1JN.1.2")
    pub book_id: String,
    pub chapter: i32,
    pub start_verse: i32,
    pub end_verse: i32,
}

#[derive(Serialize)]
pub struct CrossRefResult {
    reference_id: String,
    text: String,
}

// 1. The Data Structure
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordRow {
    pub word_order: i32,
    pub english_word: String,
    pub is_added: i32,
    pub raw_strongs: Option<String>,
    pub strongs_id: Option<String>,
    pub lemma: Option<String>,
    pub transliteration: Option<String>,
    pub pronunciation: Option<String>,
    pub kjv_def: Option<String>,
    pub definition: Option<String>,
}

// 2. The Command
#[tauri::command]
pub fn get_verse_study(
    state: tauri::State<'_, DbPaths>,
    book_id: String,
    chapter: i32,
    verse: i32,
) -> Result<Vec<WordRow>, String> {
    let trans_path = state.base_path.join("databases").join("strongs_kjv.db");
    let conn = match Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let mut stmt = match conn
        .prepare(
            "SELECT 
            vw.wordOrder,
            vw.text AS english_word,
            vw.isAdded,
            vw.strongs AS raw_strongs,
            sd.strongs AS strongs_id,
            sd.lemma,
            sd.transliteration,
            sd.pronunciation,
            sd.kjv_def,
            sd.definition
        FROM VerseWord vw
        LEFT JOIN StrongsDefinition sd ON 
            ' ' || vw.strongs || ' ' LIKE '% ' || sd.strongs || ' %'
        WHERE vw.bookId = ?1 AND vw.chapter = ?2 AND vw.verse = ?3
        ORDER BY vw.wordOrder ASC, sd.strongs ASC;",
        ) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let word_iter = match stmt
        .query_map(rusqlite::params![book_id, chapter, verse], |row| {
            Ok(WordRow {
                word_order: row.get(0)?,
                english_word: row.get(1)?,
                is_added: row.get(2)?,
                raw_strongs: row.get(3)?,
                strongs_id: row.get(4)?,
                lemma: row.get(5)?,
                transliteration: row.get(6)?,
                pronunciation: row.get(7)?,
                kjv_def: row.get(8)?,
                definition: row.get(9)?,
            })
        }) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let mut words = Vec::new();
    for word_result in word_iter {
        words.push(word_result.map_err(|e| e.to_string())?);
    }

    Ok(words)
}

#[tauri::command]
pub fn get_cross_reference_texts(
    state: tauri::State<'_, DbPaths>,
    translation_file: String,
    queries: Vec<CrossRefQuery>,
) -> Result<Vec<CrossRefResult>, String> {
    let trans_path = state.base_path.join("databases").join(&translation_file);

    // 1. GRACEFUL EXIT: If file is missing, return empty.
    if !trans_path.exists() {
        return Ok(Vec::new());
    }

    let conn = match Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let mut results = Vec::new();

    // 1. Select BOTH number and text
    let mut stmt = match conn
        .prepare(
            "SELECT number, text FROM ChapterVerse 
         WHERE bookId = ?1 AND chapterNumber = ?2 AND number BETWEEN ?3 AND ?4
         ORDER BY number ASC",
        ) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    for query in queries {
        let db_book_id = query.book_id.to_uppercase();

        // 2. Extract both values from the row
        let rows_result = stmt.query_map(
            (
                &db_book_id,
                &query.chapter,
                &query.start_verse,
                &query.end_verse,
            ),
            |row| {
                let verse_num: i32 = row.get(0)?;
                let verse_text: String = row.get(1)?;
                Ok((verse_num, verse_text))
            },
        );

        match rows_result {
            Ok(rows) => {
                let mut texts = Vec::new();
                for row_res in rows {
                    if let Ok((num, text)) = row_res {
                        // 3. Format them together: "1. In the beginning..."
                        texts.push(format!("{}. {}", num, text));
                    }
                }

                if texts.is_empty() {
                    results.push(CrossRefResult {
                        reference_id: query.ref_id,
                        text: "Text not available.".to_string(),
                    });
                } else {
                    // 4. Join them with a space
                    results.push(CrossRefResult {
                        reference_id: query.ref_id,
                        text: texts.join(" "),
                    });
                }
            }
            Err(_) => {
                results.push(CrossRefResult {
                    reference_id: query.ref_id,
                    text: "Text not available.".to_string(),
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn get_chapter_refs_availability(
    state: tauri::State<'_, DbPaths>,
    book_id: String,
    chapter: i32,
) -> Result<Vec<i32>, String> {
    let db_path = state.base_path.join("databases").join("cross_refs.db");

    // 1. GRACEFUL EXIT: If the file doesn't exist, quietly return an empty array.
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    // 2. GRACEFUL OPEN: If it fails to open for any other reason, return an empty array.
    let conn = match Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let prefix = format!("{}.{}.%", book_id.to_uppercase(), chapter);

    // 3. GRACEFUL QUERY: If the table doesn't exist or is malformed, return empty.
    let mut stmt = match conn
        .prepare("SELECT DISTINCT source_verse FROM cross_refs WHERE source_verse LIKE ?1")
    {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    let rows = match stmt.query_map([prefix], |row| row.get::<_, String>(0)) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let mut available_verses = Vec::new();
    for row in rows {
        if let Ok(source_id) = row {
            if let Some(verse_num) = source_id.split('.').last() {
                if let Ok(num) = verse_num.parse::<i32>() {
                    available_verses.push(num);
                }
            }
        }
    }

    Ok(available_verses)
}

#[tauri::command]
pub fn get_refs_for_verse(
    state: tauri::State<'_, DbPaths>,
    verse_key: String,
) -> Result<Vec<String>, String> {
    let db_path = state.base_path.join("databases").join("cross_refs.db");

    // 1. GRACEFUL EXIT: If file is missing, return empty.
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    // 2. GRACEFUL OPEN
    let conn = match Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    // 3. GRACEFUL QUERY
    let mut stmt = match conn.prepare("SELECT target_verse FROM cross_refs WHERE source_verse = ?1")
    {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    let rows = match stmt.query_map([&verse_key], |row| row.get::<_, String>(0)) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let mut refs = Vec::new();
    for ref_result in rows {
        if let Ok(target) = ref_result {
            refs.push(target);
        }
    }

    Ok(refs)
}

// List *.dba's Available Fetch::
#[tauri::command]
pub async fn get_available_translations(state: State<'_, DbPaths>) -> Result<Vec<String>, String> {
    let paths = fs::read_dir(&state.base_path.join("databases")).map_err(|e| e.to_string())?;

    let files = paths
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".dba") && !name.contains("profile"))
        .collect();
    Ok(files)
}

#[tauri::command]
pub async fn get_db_exts(state: State<'_, DbPaths>) -> Result<Vec<String>, String> {
    let paths = fs::read_dir(&state.base_path.join("databases")).map_err(|e| e.to_string())?;

    let files = paths
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".db") && !name.contains("profile"))
        .collect();
    Ok(files)
}

#[tauri::command]
pub async fn get_books(
    state: State<'_, DbPaths>,
    translation_file: String,
) -> Result<Vec<BookMetadata>, String> {
    let path = state.base_path.join("databases").join(&translation_file);
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("
        SELECT b.id, b.translationId, b.name, b.englishName, b.title, b.numberOfChapters, b.isApocryphal, b.[order]

        FROM Book b
        GROUP BY b.id
        ORDER BY b.[order] ASC
    ").map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(BookMetadata {
                id: row.get(0)?,
                translation_id: row.get(1)?,
                name: row.get(2)?,
                english_name: row.get(3)?,
                title: row.get(4)?,
                chapter_count: row.get(5)?,
                is_apocryphal: row.get(6)?,
                order: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut books = Vec::new();
    for r in rows {
        books.push(r.map_err(|e| e.to_string())?);
    }
    Ok(books)
}

#[tauri::command]
pub async fn get_translations(
    state: State<'_, DbPaths>,
    translation_file: String,
) -> Result<Vec<TranslationMetadata>, String> {
    let path = state.base_path.join("databases").join(&translation_file);
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "
        SELECT t.id, t.name, t.shortName, t.englishName, t.language

        FROM Translation t
        GROUP BY t.id
        ORDER BY t.id ASC
    ",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TranslationMetadata {
                id: row.get(0)?,
                name: row.get(1)?,
                short_name: row.get(2)?,
                english_name: row.get(3)?,
                language: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut translations = Vec::new();
    for r in rows {
        translations.push(r.map_err(|e| e.to_string())?);
    }
    Ok(translations)
}

#[tauri::command]
pub async fn get_chapter_data(
    state: tauri::State<'_, DbPaths>,
    translation_file: String,
    book: String,
    chapter: i32,
) -> Result<Value, String> {
    let trans_path = state.base_path.join("databases").join(&translation_file);
    let conn = Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    // Attach the profile database for user-specific data
    conn.execute(
        &format!("ATTACH DATABASE '{}' AS profile", state.profile_path),
        [],
    )
    .map_err(|e| e.to_string())?;

    // ---------------------------------------------------------
    // 1. THE DUAL-FUNCTION FALLBACK MECHANISM
    // ---------------------------------------------------------

    // Attempt A: Try to fetch the pre-compiled Chapter JSON
    let chapter_json_result: Result<String, _> = conn.query_row(
        "SELECT json FROM Chapter WHERE bookId = ?1 AND number = ?2",
        [&book, &chapter.to_string()],
        |row| row.get(0),
    );

    let mut chapter_data: Value = match chapter_json_result {
        Ok(json_str) => {
            // Success! Parse the existing JSON string.
            serde_json::from_str(&json_str).map_err(|e| e.to_string())?
        }
        Err(_) => {
            // Fallback: Chapter table failed/missing. Build JSON from ChapterVerse.
            let mut stmt = conn.prepare(
                "SELECT number, text FROM ChapterVerse WHERE bookId = ?1 AND chapterNumber = ?2 ORDER BY number ASC"
            ).map_err(|e| e.to_string())?;

            // Fetch all verses for this chapter
            let verse_rows = stmt
                .query_map([&book, &chapter.to_string()], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;

            let mut content_array = Vec::new();

            for row in verse_rows {
                let (v_num, v_text) = row.map_err(|e| e.to_string())?;

                // Construct a mock verse object that matches your frontend expectations
                content_array.push(json!({
                    "type": "verse",
                    "number": v_num,
                    // FIX: Wrap the plain text in a 'content' array
                    "content": [v_text]
                }));
            }

            // If we found nothing in ChapterVerse either, return an error
            if content_array.is_empty() {
                return Err(format!("Chapter {} not found in any table.", chapter));
            }

            // Wrap the array in a "content" key to mimic the root structure
            json!({
                "content": content_array
            })
        }
    };

    // ---------------------------------------------------------
    // 2. FETCH AND MERGE METADATA (Unchanged)
    // ---------------------------------------------------------

    let mut highlights = HashMap::new();
    let mut stmt_h = conn.prepare("SELECT verse_id, color FROM profile.highlights WHERE book_id = ?1 AND chapter = ?2 AND translation_id = ?3").map_err(|e| e.to_string())?;
    let h_rows = stmt_h
        .query_map([&book, &chapter.to_string(), &translation_file], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for r in h_rows {
        let (v, c) = r.map_err(|e| e.to_string())?;
        highlights.insert(v, c);
    }

    let mut notes = HashMap::new();
    let mut stmt_n = conn.prepare("SELECT verse_id, note FROM profile.notes WHERE book_id = ?1 AND chapter = ?2 AND translation_id = ?3").map_err(|e| e.to_string())?;
    let n_rows = stmt_n
        .query_map([&book, &chapter.to_string(), &translation_file], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for r in n_rows {
        let (v, n) = r.map_err(|e| e.to_string())?;
        notes.insert(v, n);
    }

    let mut topics = HashMap::new();
    let mut stmt_t = conn.prepare("SELECT verse_id, GROUP_CONCAT(topic, '|') FROM profile.topics WHERE book_id = ?1 AND chapter = ?2 AND translation_id = ?3 GROUP BY verse_id").map_err(|e| e.to_string())?;
    let t_rows = stmt_t
        .query_map([&book, &chapter.to_string(), &translation_file], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for r in t_rows {
        let (v, t) = r.map_err(|e| e.to_string())?;
        topics.insert(v, t);
    }

    // Merge Metadata into the Chapter Content
    // (This still works perfectly because our fallback JSON has "content" and "type": "verse")
    if let Some(content_array) = chapter_data
        .get_mut("content")
        .and_then(|c| c.as_array_mut())
    {
        for item in content_array {
            if item.get("type").and_then(|t| t.as_str()) == Some("verse") {
                if let Some(v_num) = item.get("number").and_then(|n| n.as_i64()) {
                    let v_i32 = v_num as i32;

                    item["highlight"] = json!(highlights.get(&v_i32));
                    item["note"] = json!(notes.get(&v_i32));
                    item["topic"] = json!(topics.get(&v_i32));
                }
            }
        }
    }

    // 4. Inject extra DB row data
    chapter_data["db_book_id"] = json!(book);
    chapter_data["db_translation_id"] = json!(translation_file);

    Ok(chapter_data)
}

#[tauri::command]
pub async fn get_chapterverse_data(
    state: State<'_, DbPaths>,
    translation_file: String,
    book: String,
    chapter: i32,
) -> Result<ChapterResponse, String> {
    let trans_path = state.base_path.join("databases").join(&translation_file);
    let conn = Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    conn.execute(
        &format!("ATTACH DATABASE '{}' AS profile", state.profile_path),
        [],
    )
    .map_err(|e| e.to_string())?;

    // 1. Fetch User Metadata (Highlights, Notes, Topics)
    let mut highlights = HashMap::new();
    let mut stmt_h = conn.prepare("SELECT verse_id, color FROM profile.highlights WHERE book_id = ?1 AND chapter = ?2 AND translation_id = ?3").map_err(|e| e.to_string())?;
    let h_rows = stmt_h
        .query_map([&book, &chapter.to_string(), &translation_file], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for r in h_rows {
        let (v, c) = r.map_err(|e| e.to_string())?;
        highlights.insert(v, c);
    }

    let mut notes = HashMap::new();
    let mut stmt_n = conn.prepare("SELECT verse_id, note FROM profile.notes WHERE book_id = ?1 AND chapter = ?2 AND translation_id = ?3").map_err(|e| e.to_string())?;
    let n_rows = stmt_n
        .query_map([&book, &chapter.to_string(), &translation_file], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for r in n_rows {
        let (v, n) = r.map_err(|e| e.to_string())?;
        notes.insert(v, n);
    }

    let mut topics = HashMap::new();
    let mut stmt_t = conn.prepare("SELECT verse_id, GROUP_CONCAT(topic, '|') FROM profile.topics WHERE book_id = ?1 AND chapter = ?2 AND translation_id = ?3 GROUP BY verse_id").map_err(|e| e.to_string())?;
    let t_rows = stmt_t
        .query_map([&book, &chapter.to_string(), &translation_file], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for r in t_rows {
        let (v, t) = r.map_err(|e| e.to_string())?;
        topics.insert(v, t);
    }

    // 2. Reconstruct Chapter Content (Verse Objects)
    let mut stmt_cv = conn.prepare(
        "SELECT number, contentJson FROM ChapterVerse WHERE bookId = ?1 AND chapterNumber = ?2 ORDER BY number ASC"
    ).map_err(|e| e.to_string())?;

    let cv_rows = stmt_cv
        .query_map([&book, &chapter.to_string()], |row| {
            let v_num: i32 = row.get(0)?;
            let json_str: String = row.get(1)?;
            Ok((v_num, json_str))
        })
        .map_err(|e| e.to_string())?;

    let mut full_content: Vec<Value> = Vec::new();
    for row in cv_rows {
        let (v_num, json_str) = row.map_err(|e| e.to_string())?;
        let inner_content: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

        full_content.push(json!({
            "content": inner_content,
            "highlight": highlights.get(&v_num),
            "note": notes.get(&v_num),
            "number": v_num,
            "topic": topics.get(&v_num),
            "type": "verse"
        }));
    }

    // 3. Footnotes using DB IDs specifically to ensure noteId matches the global database record
    let mut stmt_f = conn.prepare(
        "SELECT id, verseNumber, text FROM ChapterFootnote WHERE bookId = ?1 AND chapterNumber = ?2 ORDER BY verseNumber ASC, id ASC"
    ).map_err(|e| e.to_string())?;

    let f_rows = stmt_f
        .query_map([&book, &chapter.to_string()], |row| {
            Ok((
                row.get::<_, i32>(0)?,    // Actual DB ID (e.g., 79)
                row.get::<_, i32>(1)?,    // verseNumber
                row.get::<_, String>(2)?, // text
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut footnotes_list: Vec<Value> = Vec::new();
    for r in f_rows {
        let (db_id, v_num, f_text) = r.map_err(|e| e.to_string())?;

        footnotes_list.push(json!({
            "caller": "+",
            "noteId": db_id,
            "reference": {
                "chapter": chapter,
                "verse": v_num
            },
            "text": f_text
        }));
    }

    Ok(ChapterResponse {
        content: full_content,
        footnotes: json!(footnotes_list),
    })
}

#[tauri::command]
pub async fn copy_translation_file<R: Runtime>(
    app: AppHandle<R>,
    source_uri: String,
    file_name: String,
) -> Result<(), String> {
    // 1. Prepare target path (AppData/databases/...)
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_dir = app_dir.join("databases");

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    let target_path = target_dir.join(&file_name);

    // 2. Resolve the source bytes
    // We check if it's a URI (Android) or a standard path (Windows)
    let bytes = if source_uri.starts_with("content://") || source_uri.starts_with("file://") {
        let url = Url::parse(&source_uri).map_err(|e| e.to_string())?;
        app.fs().read(url) // Tauri treats this as a URI/URL
    } else {
        let path = PathBuf::from(&source_uri);
        app.fs().read(path) // Tauri treats this as a local FS path
    }
    .map_err(|e| e.to_string())?;

    // 3. Write to the internal AppData folder
    fs::write(target_path, bytes).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Deserialize)]
pub struct FileCopyRequest {
    #[serde(rename = "sourceUri")]
    source_uri: String,
    #[serde(rename = "fileName")]
    file_name: String,
}

#[tauri::command]
pub async fn copy_translation_files<R: Runtime>(
    app: AppHandle<R>,
    files: Vec<FileCopyRequest>,
) -> Result<(), String> {
    // 1. Prepare target directory once for all files
    let app_dir    = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_dir = app_dir.join("databases");

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    // 2. Copy each file, collecting any errors instead of bailing on the first
    let mut errors: Vec<String> = Vec::new();

    for file in &files {
        let target_path = target_dir.join(&file.file_name);

        let result = (|| -> Result<(), String> {
            let bytes = if file.source_uri.starts_with("content://")
                || file.source_uri.starts_with("file://")
            {
                let url = Url::parse(&file.source_uri).map_err(|e| e.to_string())?;
                app.fs().read(url)
            } else {
                let path = PathBuf::from(&file.source_uri);
                app.fs().read(path)
            }
            .map_err(|e| e.to_string())?;

            fs::write(&target_path, bytes).map_err(|e| e.to_string())?;
            Ok(())
        })();

        if let Err(e) = result {
            errors.push(format!("{}: {}", file.file_name, e));
        }
    }

    // 3. Surface any per-file errors as one combined message
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[tauri::command]
pub fn delete_db_file(dir: String, filename: String) -> Result<(), String> {
    let mut path = PathBuf::from(&dir);
    path.push(&filename);

    eprintln!("Deleting file: {:?}", path); // debug log

    match fs::remove_file(&path) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to delete {:?}: {}", path, e)),
    }
}

pub fn normalize_translation_id(file: &str) -> &str {
    file.trim_end_matches(".dba")
}

pub fn row_to_json(row: &rusqlite::Row) -> Value {
    use rusqlite::types::ValueRef;
    use serde_json::{json, Map, Value};

    let mut map = Map::new();
    let column_names = row.as_ref().column_names();

    for (i, name) in column_names.iter().enumerate() {
        let value = match row.get_ref(i) {
            Ok(ValueRef::Null) => Value::Null,
            Ok(ValueRef::Integer(num)) => json!(num),
            Ok(ValueRef::Real(num)) => json!(num),
            Ok(ValueRef::Text(bytes)) => {
                let s = std::str::from_utf8(bytes).unwrap_or("");

                // Auto‑parse JSON columns
                if *name == "contentJson" {
                    serde_json::from_str(s).unwrap_or_else(|_| json!(s))
                } else {
                    json!(s)
                }
            }
            Ok(ValueRef::Blob(b)) => json!(b),
            Err(_) => Value::Null,
        };

        map.insert(name.to_string(), value);
    }

    Value::Object(map)
}

#[tauri::command]
pub async fn get_verse(
    state: State<'_, DbPaths>,
    t: String,
    b: String,
    c: i32,
    v: i32,
) -> Result<Value, String> {
    let trans_path = state.base_path.join("databases").join(&t);
    let conn = Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let translation_id = normalize_translation_id(&t);

    let sql = "
        SELECT 
            Book.englishName AS BeName, 
            Book.name AS Bname, *,
            (SELECT COUNT(*) 
             FROM ChapterVerse 
             WHERE translationId = ?1 
               AND bookId = ?2 
               AND chapterNumber = ?3
            ) AS total_verses
        FROM ChapterVerse
        JOIN Book 
          ON ChapterVerse.bookId = Book.id 
         AND ChapterVerse.translationId = Book.translationId
        JOIN Translation 
          ON ChapterVerse.translationId = Translation.id
        WHERE ChapterVerse.translationId = ?1
          AND ChapterVerse.bookId = ?2
          AND ChapterVerse.chapterNumber = ?3
          AND ChapterVerse.number = ?4
        LIMIT 1";

    let result = conn
        .query_row(sql, rusqlite::params![translation_id, b, c, v], |row| {
            Ok(row_to_json(row))
        })
        .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub async fn get_verses(
    state: State<'_, DbPaths>,
    t: String,
    b: String,
    c: i32,
    vs: Vec<i32>,
) -> Result<Vec<Value>, String> {
    let trans_path = state.base_path.join("databases").join(&t);
    let conn = Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let translation_id = normalize_translation_id(&t);

    if vs.is_empty() {
        return Err("Verse list cannot be empty".into());
    }

    let placeholders = vec!["?"; vs.len()].join(", ");

    let sql = format!(
        "
        SELECT 
            Book.englishName AS BeName, 
            Book.name AS Bname, *
        FROM ChapterVerse
        JOIN Book 
          ON ChapterVerse.bookId = Book.id 
         AND ChapterVerse.translationId = Book.translationId
        JOIN Translation 
          ON ChapterVerse.translationId = Translation.id
        WHERE ChapterVerse.translationId = ?
          AND ChapterVerse.bookId = ?
          AND ChapterVerse.chapterNumber = ?
          AND ChapterVerse.number IN ({})
        ",
        placeholders
    );

    // Build params dynamically
    let mut params: Vec<&dyn ToSql> = vec![&translation_id, &b, &c];
    for v in &vs {
        params.push(v);
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), |row| {
            Ok(row_to_json(row))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_verse_count(
    state: State<'_, DbPaths>,
    t: String,
    b: String,
    c: i32,
) -> Result<i32, String> {
    let trans_path = state.base_path.join("databases").join(&t);
    let conn = Connection::open_with_flags(trans_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let translation_id = normalize_translation_id(&t);

    let count: i32 = conn
        .query_row(
            "SELECT COUNT(*)
               FROM ChapterVerse
              WHERE translationId = ?1
                AND bookId        = ?2
                AND chapterNumber = ?3",
            rusqlite::params![translation_id, b, c],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(count)
}

