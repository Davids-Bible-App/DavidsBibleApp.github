use crate::models::*;
use regex::Regex;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::State;
// use crate::models::{DbPaths};

#[derive(Serialize, Deserialize)]
pub struct VerseEntry {
    pub translation: String,
    pub book_id: String,
    pub chapter: i32,
    pub verse: i32,
    pub text: String,
}

#[tauri::command]
pub async fn parse_bible_reference(
    state: State<'_, DbPaths>,
    query: String,
    translation: String,
) -> Result<Vec<VerseEntry>, String> {
    let db_path = state.base_path.join("databases").join(&translation);
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;

    let re =
        Regex::new(r"(?i)(?:((\d\s*)?[a-zA-Z]+)[\s.]*)?(\d+)?(?::\s*(\d+))?(?:-(\d+))?").unwrap();
    let mut all_verses = Vec::new();
    let parts: Vec<&str> = query.split(',').collect();

    let mut last_was_verse_mode = false;
    let mut last_book_id: Option<String> = None;
    let mut last_chapter: Option<i32> = None;

    for part in parts {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(caps) = re.captures(trimmed) {
            let has_book = caps.get(1).is_some();
            let has_colon = caps.get(4).is_some();
            let has_dash = caps.get(5).is_some();

            let book_id = if let Some(b_match) = caps.get(1) {
                let resolved = normalize_book_id(b_match.as_str());
                last_book_id = Some(resolved.clone());
                resolved
            } else {
                last_book_id.clone().unwrap_or_default()
            };

            if book_id.is_empty() {
                continue;
            }

            let n1 = caps.get(3).and_then(|m| m.as_str().parse::<i32>().ok());
            let n2 = caps.get(4).and_then(|m| m.as_str().parse::<i32>().ok());
            let n3 = caps.get(5).and_then(|m| m.as_str().parse::<i32>().ok());

            let mut chapter = last_chapter.unwrap_or(1);
            let mut v_start: Option<i32> = None;
            let mut v_end: Option<i32> = None;
            let mut query_chapters = false;

            match (has_book, has_colon, has_dash) {
                // Scenario: Gen 1:1-5 or Shorthand :1-5
                (_, true, true) => {
                    chapter = n1.unwrap_or(chapter);
                    v_start = n2;
                    v_end = n3;
                    last_was_verse_mode = true;
                }
                // Scenario: Gen 1:1 or Shorthand :1
                (_, true, false) => {
                    chapter = n1.unwrap_or(chapter);
                    v_start = n2;
                    v_end = n2;
                    last_was_verse_mode = true;
                }
                // Scenario: Gen 1-3 (Chapter Range)
                (true, false, true) => {
                    chapter = n1.unwrap_or(1);
                    v_end = n3;
                    query_chapters = true;
                    last_was_verse_mode = false;
                }
                // Scenario: Gen 1 (Full Chapter)
                (true, false, false) => {
                    chapter = n1.unwrap_or(1);
                    last_was_verse_mode = false;
                }
                // The "Shorthand" Fallback
                _ => {
                    if last_was_verse_mode {
                        // We are in a "Verse" context (e.g., Mat 1:1, 3)
                        v_start = n1;
                        v_end = if has_dash { n3 } else { n1 };
                    } else {
                        // We are in a "Chapter" context (e.g., Mat 1, 3)
                        chapter = n1.unwrap_or(chapter);
                        if has_dash {
                            v_end = n3;
                            query_chapters = true;
                        }
                        last_was_verse_mode = false;
                    }
                }
            }

            last_chapter = Some(chapter);

            let mut sql =
                "SELECT bookId, chapterNumber, number, text FROM ChapterVerse WHERE bookId = ?1"
                    .to_string();
            let mut params_vec: Vec<rusqlite::types::Value> = vec![book_id.into()];

            if query_chapters {
                sql.push_str(" AND chapterNumber BETWEEN ?2 AND ?3");
                params_vec.push(chapter.into());
                params_vec.push(v_end.unwrap_or(chapter).into());
            } else {
                sql.push_str(" AND chapterNumber = ?2");
                params_vec.push(chapter.into());
                if let Some(start) = v_start {
                    sql.push_str(" AND number BETWEEN ?3 AND ?4");
                    params_vec.push(start.into());
                    params_vec.push(v_end.unwrap_or(start).into());
                }
            }

            sql.push_str(" ORDER BY chapterNumber ASC, number ASC");

            let translation_clone = translation.clone();
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(params_vec), |row| {
                    Ok(VerseEntry {
                        translation: translation_clone.clone(),
                        book_id: row.get(0)?,
                        chapter: row.get(1)?,
                        verse: row.get(2)?,
                        text: row.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?;

            for r in rows {
                if let Ok(v) = r {
                    all_verses.push(v);
                }
            }
        }
    }
    Ok(all_verses)
}

// Added More Abbreviations, more to catch mistakes or habits.
pub fn normalize_book_id(raw: &str) -> String {
    let clean = raw.to_uppercase().replace(" ", "");
    match clean.as_str() {
        "GENESIS" | "GEN" => "GEN",
        "EXODUS" | "EX" | "EXO" => "EXO",
        "LEVITICUS" | "LE" | "LEV" => "LEV",
        "NUMBERS" | "NU" | "NUM" => "NUM",
        "DEUTERONOMY" | "DEUT" | "DEU" => "DEU",
        "JOSHUA" | "JOSH" | "JOS" => "JOS",
        "JUDGES" | "JUDG" | "JDG" => "JDG",
        "RUTH" | "RU" | "RTH" | "RUT" => "RUT",
        "1SAMUEL" | "1SM" | "1SAM" | "1SA" => "1SA",
        "2SAMUEL" | "2SM" | "2SAM" | "2SA" => "2SA",
        "1KINGS" | "1KGS" | "1KI" => "1KI",
        "2KINGS" | "2KGS" | "2KI" => "2KI",
        "1CHRONICLES" | "1CHR" | "1CH" => "1CH",
        "2CHRONICLES" | "2CHR" | "2CH" => "2CH",
        "EZRA" | "EZR" => "EZR",
        "NEHEMIAH" | "NE" | "NEM" | "NEH" => "NEH",
        "ESTHER" | "ES" | "EST" => "EST",
        "JOB" | "JB" | "JO" => "JOB",
        "PSALMS" | "PS" | "PSA" | "PSALM" | "PSS" => "PSA",
        "PROVERBS" | "PR" | "PRV" | "PROV" | "PRO" => "PRO",
        "ECCLESIASTES" | "EC" | "ECCL" | "ECC" => "ECC",
        "SONGOFSOLOMON" | "SO" | "SON" | "SNG" | "SONGS" => "SNG",
        "ISAIAH" | "IS" | "ISAH" | "ISA" => "ISA",
        "JEREMIAH" | "JE" | "JERE" | "JER" => "JER",
        "LAMENTATIONS" | "LM" | "LA" | "LAMEN" | "LAM" => "LAM",
        "EZEKIEL" | "EZ" | "EZE" | "EZK" => "EZK",
        "DANIEL" | "DA" | "DAN" => "DAN",
        "HOSEA" | "HO" | "HOSE" | "HOS" => "HOS",
        "JOEL" | "JOE" | "JOL" => "JOL",
        "AMOS" | "AM" | "AMS" | "AMO" => "AMO",
        "OBADIAH" | "OB" | "OBAD" | "OBA" => "OBA",
        "JONAH" | "JONA" | "JON" => "JON",
        "MICAH" | "MI" | "MICA" | "MIC" => "MIC",
        "NAHUM" | "NA" | "NAM" => "NAM",
        "HABAKKUK" | "HA" | "HAB" => "HAB",
        "ZEPHANIAH" | "ZE" | "ZEPH" | "ZEP" => "ZEP",
        "HAGGAI" | "HAGG" | "HAG" => "HAG",
        "ZECHARIAH" | "ZECH" | "ZEC" => "ZEC",
        "MALACHI" | "MAL" => "MAL",
        "MATTHEW" | "MT" | "MATT" | "MAT" => "MAT",
        "MARK" | "MK" | "MR" | "MAR" | "MRK" => "MRK",
        "LUKE" | "LUK" | "LK" | "LU" => "LUK",
        "JOHN" | "JHN" | "JN" => "JHN",
        "ACTS" | "AC" | "ACT" => "ACT",
        "ROMANS" | "ROM" | "RM" | "RO" => "ROM",
        "1CORINTHIANS" | "1COR" | "1C" | "1CR" | "1CO" => "1CO",
        "2CORINTHIANS" | "2COR" | "2C" | "2CR" | "2CO" => "2CO",
        "GALATIANS" | "GAL" | "GA" => "GAL",
        "EPHESIANS" | "EPH" | "EP" => "EPH",
        "PHILIPPIANS" | "PHIL" | "PHP" => "PHP",
        "COLOSSIANS" | "CO" | "CL" | "COL" => "COL",
        "1THESSALONIANS" | "1THES" | "1THS" | "1TH" => "1TH",
        "2THESSALONIANS" | "2THES" | "2THS" | "2TH" => "2TH",
        "1TIMOTHY" | "1TIM" | "1T" | "1TI" => "1TI",
        "2TIMOTHY" | "2TIM" | "2T" | "2TI" => "2TI",
        "TITUS" | "TI" | "TIT" => "TIT",
        "PHILEMON" | "PM" | "PHLM" | "PHM" => "PHM",
        "HEBREWS" | "HE" | "HEB" => "HEB",
        "JAMES" | "JA" | "JAM" | "JAS" => "JAS",
        "1PETER" | "1P" | "1PET" | "1PE" => "1PE",
        "2PETER" | "2P" | "2PET" | "2PE" => "2PE",
        "1JOHN" | "1J" | "1JON" | "1JN" => "1JN",
        "2JOHN" | "2J" | "2JON" | "2JN" => "2JN",
        "3JOHN" | "3J" | "3JON" | "3JN" => "3JN",
        "JUDE" | "JU" | "JUD" => "JUD",
        "REVELATION" | "RE" | "RV" | "REV" => "REV",
        "TOBIT" | "TB" | "TOB" => "TOB",
        "JUDITH" | "JDT" => "JDT",
        "WISDOM" | "WIS" => "WIS",
        "SIRACH" | "SIR" => "SIR",
        "BARUCH" | "BAR" => "BAR",
        "1MACCABEES" | "1MAC" | "1MACC" | "1MA" => "1MA",
        "2MACCABEES" | "2MAC" | "2MACC" | "2MA" => "2MA",
        _ => clean.as_str(),
    }
    .to_string()
}

// #[tauri::command]
// pub async fn save_context_history(state: State<'_, DbPaths>, query: String) -> Result<(), String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     conn.execute(
//         "INSERT OR REPLACE INTO context_history (query) VALUES (?1)",
//         [&query],
//     ).map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[tauri::command]
// pub async fn get_context_history(
//     state: State<'_, DbPaths>,
//     limit: i32
// ) -> Result<Vec<String>, String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     let mut stmt = conn.prepare("SELECT query FROM context_history ORDER BY timestamp DESC LIMIT ?1")
//         .map_err(|e| e.to_string())?;

//     let rows = stmt.query_map([limit], |row| row.get(0)).map_err(|e| e.to_string())?;
//     let mut history = Vec::new();
//     for r in rows { history.push(r.map_err(|e| e.to_string())?); }
//     Ok(history)
// }

// #[tauri::command]
// pub async fn delete_context_history_item(state: State<'_, DbPaths>, query: String) -> Result<(), String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     conn.execute(
//         "DELETE FROM context_history WHERE query = ?1",
//         [&query],
//     ).map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[tauri::command]
// pub async fn clear_context_history(state: State<'_, DbPaths>) -> Result<(), String> {
//     let conn = Connection::open(&state.profile_path).map_err(|e| e.to_string())?;
//     conn.execute("DELETE FROM context_history", []).map_err(|e| e.to_string())?;
//     Ok(())
// }
