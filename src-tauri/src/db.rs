use log::{error, info};
use rusqlite::Connection;
use std::fs;
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tauri_plugin_fs::FsExt;

pub fn init_db(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().expect("Failed dir");
    std::fs::create_dir_all(&app_dir).ok();
    let profile_path = app_dir.join("profile.db").to_string_lossy().into_owned();

    let conn = Connection::open(&profile_path).unwrap();
    conn.execute("PRAGMA journal_mode=WAL;", []).ok();

    conn.execute_batch(
        "
        -- Core User Data
        CREATE TABLE IF NOT EXISTS highlights (
            id INTEGER PRIMARY KEY,
            translation_id TEXT,
            book_id TEXT,
            chapter INTEGER,
            verse_id INTEGER,
            color TEXT,
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            UNIQUE(translation_id, book_id, chapter, verse_id)
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY,
            translation_id TEXT,
            book_id TEXT,
            chapter INTEGER,
            verse_id INTEGER,
            note TEXT,
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            UNIQUE(translation_id, book_id, chapter, verse_id)
        );

        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY,
            translation_id TEXT,
            book_id TEXT,
            chapter INTEGER,
            verse_id INTEGER,
            topic TEXT,
            topic_sort INTEGER DEFAULT 0,   -- Added for custom Topic ordering
            verse_sort INTEGER DEFAULT 0,   -- Added for custom Group/Verse ordering
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            UNIQUE(translation_id, book_id, chapter, verse_id, topic)
        );

        -- Meta Tables (Unchanged)
        CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY,
            query TEXT UNIQUE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS context_history (
            id INTEGER PRIMARY KEY,
            query TEXT UNIQUE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS topic_metadata (
            topic TEXT PRIMARY KEY,
            description TEXT,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );

        -- NEW: Book Reference Table
        CREATE TABLE IF NOT EXISTS Book (
            id TEXT PRIMARY KEY,
            englishName TEXT,
            \"order\" INTEGER
        );

        -- Insert Books safely
        INSERT OR IGNORE INTO Book (id, englishName, \"order\") VALUES 
        ('1CH','1 Chronicles',13), ('1CO','1 Corinthians',46), ('1JN','1 John',62),
        ('1KI','1 Kings',11), ('1MA','1 Maccabees',77), ('1PE','1 Peter',60),
        ('1SA','1 Samuel',9), ('1TH','1 Thessalonians',52), ('1TI','1 Timothy',54),
        ('2CH','2 Chronicles',14), ('2CO','2 Corinthians',47), ('2JN','2 John',63),
        ('2KI','2 Kings',12), ('2MA','2 Maccabees',78), ('2PE','2 Peter',61),
        ('2SA','2 Samuel',10), ('2TH','2 Thessalonians',53), ('2TI','2 Timothy',55),
        ('3JN','3 John',64), ('ACT','Acts',44), ('AMO','Amos',30),
        ('BAR','Baruch',72), ('COL','Colossians',51), ('DAN','Daniel',27),
        ('DEU','Deuteronomy',5), ('ECC','Ecclesiastes',21), ('EPH','Ephesians',49),
        ('EST','Esther',17), ('EXO','Exodus',2), ('EZK','Ezekiel',26),
        ('EZR','Ezra',15), ('GAL','Galatians',48), ('GEN','Genesis',1),
        ('HAB','Habakkuk',35), ('HAG','Haggai',37), ('HEB','Hebrews',58),
        ('HOS','Hosea',28), ('ISA','Isaiah',23), ('JAS','James',59),
        ('JDG','Judges',7), ('JDT','Judith',68), ('JER','Jeremiah',24),
        ('JHN','John',43), ('JOB','Job',18), ('JOL','Joel',29),
        ('JON','Jonah',32), ('JOS','Joshua',6), ('JUD','Jude',65),
        ('LAM','Lamentations',25), ('LEV','Leviticus',3), ('LUK','Luke',42),
        ('MAL','Malachi',39), ('MAT','Matthew',40), ('MIC','Micah',33),
        ('MRK','Mark',41), ('NAM','Nahum',34), ('NEH','Nehemiah',16),
        ('NUM','Numbers',4), ('OBA','Obadiah',31), ('PHM','Philemon',57),
        ('PHP','Philippians',50), ('PRO','Proverbs',20), ('PSA','Psalms',19),
        ('REV','Revelation',66), ('ROM','Romans',45), ('RUT','Ruth',8),
        ('SIR','Sirach',71), ('SNG','Song of Solomon',22), ('TIT','Titus',56),
        ('TOB','Tobit',67), ('WIS','Wisdom of Solomon',70), ('ZEC','Zechariah',38),
        ('ZEP','Zephaniah',36);

        -- Performance Indexes
        CREATE INDEX IF NOT EXISTS idx_hi ON highlights(translation_id, book_id, chapter);
        CREATE INDEX IF NOT EXISTS idx_nt ON notes(translation_id, book_id, chapter);
        CREATE INDEX IF NOT EXISTS idx_tp ON topics(translation_id, book_id, chapter);
        CREATE INDEX IF NOT EXISTS idx_tm ON topic_metadata(topic);

        -- Views
        DROP VIEW IF EXISTS gallery_view_raw;
        CREATE VIEW gallery_view_raw AS
        SELECT
            'note' as entry_type, id, translation_id, book_id, chapter, verse_id,
            note, NULL as topic, NULL as highlight, 
            0 as topic_sort, 0 as verse_sort   -- Filler for UNION ALL match
        FROM notes
        UNION ALL
        SELECT
            'highlight' as entry_type, id, translation_id, book_id, chapter, verse_id,
            NULL as note, NULL as topic, color as highlight, 
            0 as topic_sort, 0 as verse_sort   -- Filler for UNION ALL match
        FROM highlights
        UNION ALL
        SELECT
            'topic' as entry_type, id, translation_id, book_id, chapter, verse_id,
            NULL as note, topic, NULL as highlight, 
            topic_sort, verse_sort             -- Actual sort data
        FROM topics;

        DROP VIEW IF EXISTS reader_view;
        CREATE VIEW reader_view AS
        SELECT translation_id, book_id, chapter, verse_id,
                GROUP_CONCAT(topic, ', ') as topic_list,
                MAX(note) as note,
                MAX(highlight) as highlight
        FROM gallery_view_raw
        GROUP BY translation_id, book_id, chapter, verse_id;

        CREATE TABLE IF NOT EXISTS MemeTemplates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            thumbnail TEXT,
            payload TEXT NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );
        
        CREATE TABLE IF NOT EXISTS read_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            translation_id TEXT,
            book_id TEXT,
            chapter INTEGER,
            verse_id INTEGER,
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            UNIQUE(translation_id, book_id, chapter, verse_id)
        );
        CREATE INDEX IF NOT EXISTS idx_history_time ON read_history(updated_at DESC);

        CREATE TABLE IF NOT EXISTS bookmarks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL UNIQUE,
            verses     TEXT    NOT NULL,   -- JSON: [{tr, bk, ch, vs}, ...]
            sort_order INTEGER DEFAULT 0,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );
        
        CREATE INDEX IF NOT EXISTS idx_bm_time ON bookmarks(updated_at DESC);
    ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn setup_resources(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Get the app's private data directory
    let app_dir = app.path().app_data_dir()?;

    // 2. Define the target DB file path (and its parent folder)
    let db_dir = app_dir.join("databases");
    let target_file = db_dir.join("eng_kjv.dba");

    // 3. Create the FULL path including "databases"
    if !db_dir.exists() {
        // create_dir_all creates app_dir AND databases in one go
        std::fs::create_dir_all(&db_dir)?;
    }

    // 4. Only copy the DB if it doesn't exist
    if !target_file.exists() {
        info!("Initializing database for the first time...");

        // 3. Resolve the path to the file inside the APK resources
        // This maps to "asset://localhost/resources/databases/eng_kjv.dba" on Android
        let resource_path = app
            .path()
            .resolve("resources/databases/eng_kjv.dba", BaseDirectory::Resource)?;

        // 4. Read the bytes using the Tauri FS Plugin
        match app.fs().read(&resource_path) {
            Ok(bytes) => {
                // Write the DB to disk
                fs::write(&target_file, bytes)?;
                info!("Database successfully initialized at {:?}", target_file);
            }
            Err(e) => {
                error!("Critical Error: Failed to extract database from APK: {}", e);
                return Err(e.into());
            }
        }
    }

    Ok(())
}
