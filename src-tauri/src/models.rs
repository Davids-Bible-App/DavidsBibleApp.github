use crate::commands::context::VerseEntry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

pub struct DbPaths {
    pub base_path: PathBuf,
    pub profile_path: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChapterResponse {
    pub content: Vec<Value>,
    pub footnotes: Value,
}

#[derive(Serialize)]
pub struct BookMetadata {
    pub id: String,
    pub translation_id: String,
    pub name: String,
    pub english_name: String,
    pub title: String,
    pub chapter_count: i32,
    pub is_apocryphal: i32,
    pub order: i32,
}

#[derive(Serialize)]
pub struct TranslationMetadata {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub english_name: String,
    pub language: String,
}

// Search Structs

#[derive(Serialize, Deserialize)]
pub struct SearchHit {
    pub translation: String,
    pub book_id: String,
    pub chapter: i32,
    pub verse: i32,
    pub text: String,
}

#[derive(Serialize, Deserialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub total_count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum UnifiedResult {
    Reference(Vec<VerseEntry>),
    Keyword(SearchResponse),
}

// #[derive(Serialize)]
// pub struct Verse {
//     pub number: i32,
//     pub text: String,
//     pub footnotes: Option<String>,
//     pub content_json: Option<String>,
//     pub highlight: Option<String>,
//     pub note: Option<String>,
//     pub topic: Option<String>,
// }

// #[derive(Serialize)]
// pub struct SearchResponse {
//     pub hits: Vec<SearchHit>,
//     pub total_count: u32,
// }

// Gallery Structs

#[derive(Serialize)]
pub struct GalleryEntry {
    pub entry_type: String,
    pub id: i32,
    pub translation_id: String,
    pub book_id: String,
    pub book_name: String,
    pub chapter: i32,
    pub verse_id: i32,
    pub text: String,
    pub note: Option<String>,
    pub topic: Option<String>,
    pub highlight: Option<String>,
}
