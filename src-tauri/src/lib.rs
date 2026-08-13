mod commands;
mod db;
mod models; // Points to commands/mod.rs
use tauri::Manager;
use crate::commands::audio::{MyService, TimerState};

#[tauri::command]
async fn initialize_profile_db(app: tauri::AppHandle) -> Result<bool, String> {
    // Snapshot first-run state BEFORE doing any work
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let is_first_run = !app_dir.join("databases").join("eng_kjv.dba").exists();

    // Copy eng_kjv.dba on first run only (no-op if it already exists)
    crate::db::setup_resources(&app).map_err(|e| e.to_string())?;

    // Create / migrate profile.db (always idempotent)
    crate::db::init_db(&app).map_err(|e| e.to_string())?;

    Ok(is_first_run) // frontend uses this to decide its delay strategy
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let timer_state = TimerState::default();
    let timer_state_for_service = timer_state.clone();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(timer_state)
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_m3::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_keep_screen_on::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_music_notification_api::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_background_service::init_with_service(
            move || MyService::new(timer_state_for_service.clone()),
        ))
        .setup(|app| {
            // First Run - Setup, Create, Initialise.
            let app_dir = app.path().app_data_dir().unwrap();
            let profile_path = app_dir.join("profile.db").to_string_lossy().into_owned();
            app.manage(crate::models::DbPaths {
                base_path: app_dir,
                profile_path,
            });
            Ok(())
        });

    // 1. Handle OS-specific Plugins
    #[cfg(target_os = "windows")]
        {
        builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());
        }

    // 2. Consolidated Invoke Handler
    builder
        .invoke_handler(tauri::generate_handler![
            initialize_profile_db,

            // From commands/audio.rs
            commands::audio::get_available_authors,
            commands::audio::import_audio_zip,
            commands::audio::delete_author,
            commands::audio::read_audio_file,
            commands::audio::get_playlist,
            commands::audio::get_book_playlist,
            commands::audio::timer_start,
            commands::audio::timer_pause,
            commands::audio::timer_resume,
            commands::audio::timer_cancel,
            commands::audio::timer_get_remaining,

            // From commands/bookmark.rs
            commands::bookmark::add_bookmark,
            commands::bookmark::rename_bookmark,
            commands::bookmark::delete_bookmark,
            commands::bookmark::get_bookmarks,
            commands::bookmark::reorder_bookmarks,
            commands::bookmark::overwrite_bookmark,

            // From commands/meme.rs
            commands::meme::save_meme_image,
            commands::meme::delete_meme_image,

            // From commands/context.rs
            commands::context::parse_bible_reference,

            // From commands/search.rs
            commands::search::unified_search,
            commands::search::fts5_search_all_selected,

            // From commands/reader.rs
            commands::reader::copy_translation_file,
            commands::reader::copy_translation_files,
            commands::reader::delete_db_file,

            commands::reader::lookup_strongs,
            commands::reader::get_db_exts,
            commands::reader::get_verse_study,
            commands::reader::get_refs_for_verse,
            commands::reader::get_chapter_refs_availability,
            commands::reader::get_cross_reference_texts,
            commands::reader::get_available_translations,
            commands::reader::get_translations,
            commands::reader::get_books,
            commands::reader::get_chapter_data,
            commands::reader::get_chapterverse_data,
            commands::reader::get_verse,
            commands::reader::get_verses,
            commands::reader::get_verse_count,
            
            // From commands/profile.rs
            commands::profile::get_read_history,
            commands::profile::log_history_entry,
            commands::profile::delete_history_entry,
            commands::profile::clear_all_history,
            commands::profile::save_template,
            commands::profile::get_templates,
            commands::profile::delete_template,
            commands::profile::get_global_gallery,
            commands::profile::get_active_filters,
            commands::profile::delete_gallery_entry,
            commands::profile::get_single_note,
            commands::profile::save_note,
            commands::profile::save_note_by_id,
            commands::profile::toggle_highlight_batch,
            commands::profile::rename_topic,
            commands::profile::delete_topic,
            commands::profile::save_verses_to_topic,
            commands::profile::get_topics_metadata,
            commands::profile::get_topic_verses,
            commands::profile::update_topics_order,
            commands::profile::update_verses_order,
            commands::profile::save_topic_description,
            commands::profile::get_topic_description,
            commands::profile::merge_external_profile_db,
            commands::profile::replace_profile_db,
            commands::profile::export_profile_db,
            commands::profile::set_config,
            commands::profile::get_config,
            commands::profile::set_configs,
            commands::profile::get_configs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
