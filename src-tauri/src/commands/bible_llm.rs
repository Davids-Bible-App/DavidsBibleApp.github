use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

pub const DEFAULT_SYSTEM_PROMPT: &str = 
    "You are a helpful Bible study assistant. If uncertain, say so rather than fabricating information.";

pub fn prompt_path_for(model_path: &Path) -> PathBuf {
    let stem = model_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let mut p = model_path.to_path_buf();
    p.set_file_name(format!("{stem}.prompt.txt"));
    p
}

/// Resolve the effective system prompt for a model.
/// Precedence (mirrors `get_effective_prompt` in llm_models.rs):
///   settings-table override > sibling `.prompt.txt` file > built-in default.
// ← FIXED: this function was called by `load_model_internal` but never existed.
#[cfg_attr(target_os = "android", allow(dead_code))]
pub fn resolve_system_prompt(
    app: &tauri::AppHandle,
    model_path: &Path,
    filename: &str,
) -> String {
    let key = format!("prompt_override:{filename}");
    if let Ok(Some(prompt)) = crate::commands::llm_models::get_setting(app, &key) {
        return prompt;
    }

    let prompt_file = prompt_path_for(model_path);
    if let Ok(prompt) = std::fs::read_to_string(&prompt_file) {
        return prompt;
    }

    DEFAULT_SYSTEM_PROMPT.to_string()
}

// ← FIXED: restored the real implementation — the no-op stub would have silently
// swallowed set_prompt_override / delete_prompt_override for the active model.
pub fn set_active_system_prompt(app: &tauri::AppHandle, prompt: &str) {
    let state = app.state::<ModelState>();
    *state.system_prompt.lock().unwrap() = prompt.to_string();
}

#[cfg(not(target_os = "android"))]
mod desktop {    
    use super::{ChatTurn, DEFAULT_SYSTEM_PROMPT}; // ← FIXED: child module needs the parent's const in scope
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::{AddBos, LlamaModel};
    use llama_cpp_2::sampling::LlamaSampler;
    use std::num::NonZeroU32;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, Manager, State};

    const N_CTX: u32 = 8192;
    const MAX_NEW_TOKENS: u32 = 2048;
    const STOP_SEQUENCES: [&str; 4] = [
        "<end_of_turn>",
        "<start_of_turn>user",
        "<start_of_turn>system",
        "<start_of_turn>model",
    ];

    pub struct ModelState {
        pub backend: LlamaBackend,
        pub model: Mutex<Option<LlamaModel>>,
        pub system_prompt: Mutex<String>,
        pub cancel: AtomicBool,   
    }

    impl ModelState {
        pub fn new() -> Self {
            Self {
                backend: LlamaBackend::init().expect("failed to init llama.cpp backend"),
                model: Mutex::new(None),
                system_prompt: Mutex::new(DEFAULT_SYSTEM_PROMPT.to_string()),
                cancel: AtomicBool::new(false),
            }
        }
    }

    pub fn load_model_internal(path: String, app: &AppHandle) -> Result<(), String> {
        let state = app.state::<ModelState>();
        let model_path = PathBuf::from(&path);
        let filename = model_path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();

        let requested_layers = crate::commands::llm_models::get_setting(app, &format!("gpu_layers:{filename}"))
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        let model = load_with_gpu_fallback(&state.backend, &model_path, requested_layers, app)
            .map_err(|e| format!("Failed to load model at {path}: {e}"))?;

        let system_prompt = super::resolve_system_prompt(app, &model_path, &filename);
        *state.model.lock().unwrap() = Some(model);
        *state.system_prompt.lock().unwrap() = system_prompt;
        Ok(())
    }

    // Tries the requested GPU offload first; if that fails (no compatible GPU,
    // not enough VRAM, driver issue, etc.) retries once on CPU-only rather than
    // letting the whole load fail — a user with an old/no GPU should still be
    // able to run the model, just slower. Emits a warning to the frontend when
    // it had to fall back, so the "loud fan" surprise isn't silent.
    fn load_with_gpu_fallback(
        backend: &LlamaBackend,
        model_path: &PathBuf,
        n_gpu_layers: u32,
        app: &AppHandle,
    ) -> Result<LlamaModel, String> {
        if n_gpu_layers > 0 {
            let gpu_params = LlamaModelParams::default().with_n_gpu_layers(n_gpu_layers);
            match LlamaModel::load_from_file(backend, model_path, &gpu_params) {
                Ok(model) => return Ok(model),
                Err(e) => {
                    eprintln!("GPU load failed ({e}), retrying on CPU");
                    let _ = app.emit(
                        "model-gpu-fallback",
                        "Not Enough GPU memory; running on CPU instead.".to_string(),
                    );
                }
            }
        }

        let cpu_params = LlamaModelParams::default().with_n_gpu_layers(0);
        LlamaModel::load_from_file(backend, model_path, &cpu_params).map_err(|e| e.to_string())
    }

    // ← NEW: drops the loaded weights and resets the in-memory prompt back
    // to default. Called from llm_models::unload_llm_model.
    pub fn unload_model_internal(app: &AppHandle) {
        let state = app.state::<ModelState>();
        *state.model.lock().unwrap() = None;
        *state.system_prompt.lock().unwrap() = DEFAULT_SYSTEM_PROMPT.to_string();
    }

    #[tauri::command]
    pub fn load_model(path: String, app: AppHandle) -> Result<(), String> {
        load_model_internal(path, &app)
    }

    #[tauri::command]
    pub fn is_model_loaded(state: State<'_, ModelState>) -> bool {
        state.model.lock().unwrap().is_some()
    }

    #[tauri::command]
    pub fn cancel_chat(state: State<'_, ModelState>) {
        state.cancel.store(true, Ordering::Relaxed);
    }


    /// Matches Ollama's TEMPLATE blob exactly:
    ///   {{- if .System }}<start_of_turn>system\n{{ .System }}<end_of_turn>\n{{- end }}
    ///   <start_of_turn>user\n{{ .Prompt }}<end_of_turn>\n<start_of_turn>model\n
    /// The system turn only ever appears once, at the very start. Every later
    /// turn is user/model pairs, with the assistant role tag being "model".
    fn format_prompt(system_prompt: &str, history: &[ChatTurn], user_msg: &str) -> String {
        let mut prompt = format!("<start_of_turn>system\n{system_prompt}<end_of_turn>\n");

        for turn in history {
            let tag = if turn.role == "assistant" { "model" } else { "user" };
            prompt.push_str(&format!(
                "<start_of_turn>{tag}\n{}<end_of_turn>\n",
                turn.content
            ));
        }

        prompt.push_str(&format!(
            "<start_of_turn>user\n{user_msg}<end_of_turn>\n<start_of_turn>model\n"
        ));
        prompt
    }

    /// Returns how many trailing bytes of `text` are a prefix of some stop
    /// sequence (and therefore unsafe to emit yet, since more tokens could
    /// complete the match). Respects UTF-8 boundaries.
    fn holdback_len(text: &str, stops: &[&str]) -> usize {
        let max_len = stops.iter().map(|s| s.len()).max().unwrap_or(0);
        let mut start = text.len().saturating_sub(max_len);
        while start < text.len() && !text.is_char_boundary(start) {
            start += 1;
        }
        for (offset, _) in text[start..].char_indices() {
            let candidate = &text[start + offset..];
            if stops.iter().any(|s| s.starts_with(candidate)) {
                return text.len() - (start + offset);
            }
        }
        0
    }

    #[tauri::command]
    pub async fn chat(prompt: String, history: Vec<ChatTurn>, app: AppHandle) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let state = app.state::<ModelState>();
            state.cancel.store(false, Ordering::Relaxed);

            let model_guard = state.model.lock().unwrap();
            let model = model_guard
                .as_ref()
                .ok_or_else(|| "Model isn't loaded yet.".to_string())?;
            let system_prompt = state.system_prompt.lock().unwrap().clone();

            let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(N_CTX));
            let mut ctx = model
                .new_context(&state.backend, ctx_params)
                .map_err(|e| format!("Failed to create context: {e}"))?;

            let full_prompt = format_prompt(&system_prompt, &history, &prompt);
            let tokens = model
                .str_to_token(&full_prompt, AddBos::Always)
                .map_err(|e| format!("Tokenize failed: {e}"))?;

            if tokens.len() as u32 >= N_CTX {
                return Err("Conversation is too long for the model's context window.".to_string());
            }

            let mut batch = LlamaBatch::new(N_CTX as usize, 1);
            let last_index = tokens.len() as i32 - 1;
            for (i, token) in tokens.iter().enumerate() {
                batch
                    .add(*token, i as i32, &[0], i as i32 == last_index)
                    .map_err(|e| e.to_string())?;
            }
            ctx.decode(&mut batch)
                .map_err(|e| format!("Initial decode failed: {e}"))?;

            let mut sampler = LlamaSampler::chain_simple([
                LlamaSampler::penalties(64, 64, 1.15, 0.0, 0.0),
                LlamaSampler::greedy(),
            ]);

            let mut n_cur = tokens.len() as i32;
            let mut n_generated: u32 = 0;
            let mut generated_text = String::new();
            let mut emitted_len = 0usize;

            loop {
                let token = sampler.sample(&ctx, batch.n_tokens() - 1);
                sampler.accept(token);

                if state.cancel.load(Ordering::Relaxed) {
                    // Emit everything generated so far (the holdback tail included —
                    // a stray partial "<start" fragment is an acceptable trade for a
                    // user-requested stop) and tell the UI this ended by cancellation.
                    if generated_text.len() > emitted_len {
                        app.emit("chat-token", generated_text[emitted_len..].to_string()).ok();
                    }
                    app.emit("chat-cancelled", ()).ok();
                    break;
                }

                if model.is_eog_token(token) {
                    break;
                }

                let bytes = model
                    .token_to_piece_bytes(token, 64, true, None)
                    .map_err(|e| e.to_string())?;
                generated_text.push_str(&String::from_utf8_lossy(&bytes));

                if let Some(stop_pos) = STOP_SEQUENCES
                    .iter()
                    .filter_map(|s| generated_text[emitted_len..].find(s).map(|p| emitted_len + p))
                    .min()
                {
                    if stop_pos > emitted_len {
                        app.emit("chat-token", generated_text[emitted_len..stop_pos].to_string())
                            .ok();
                    }
                    break;
                }

                let hold = holdback_len(&generated_text, &STOP_SEQUENCES);
                let safe_upto = generated_text.len() - hold;
                if safe_upto > emitted_len {
                    app.emit("chat-token", generated_text[emitted_len..safe_upto].to_string())
                        .ok();
                    emitted_len = safe_upto;
                }

                n_generated += 1;
                n_cur += 1;
                if n_generated >= MAX_NEW_TOKENS || n_cur as u32 >= N_CTX {
                    break;
                }

                batch.clear();
                batch.add(token, n_cur - 1, &[0], true).map_err(|e| e.to_string())?;
                ctx.decode(&mut batch)
                    .map_err(|e| format!("Decode failed: {e}"))?;
            }

            Ok(())
        })
        .await
        .map_err(|e| format!("Generation task panicked: {e}"))?
    }

    #[tauri::command]
    pub fn get_active_model_layer_count(state: State<'_, ModelState>) -> Result<u32, String> {
        let model_guard = state.model.lock().unwrap();
        let model = model_guard
            .as_ref()
            .ok_or_else(|| "Load the model first to configure GPU layers.".to_string())?;
        Ok(model.n_layer() as u32)
    }

    use ash::vk;

    #[tauri::command]
    pub fn get_gpu_vram_mib() -> Option<u64> {
        // This is TOTAL VRAM, not free VRAM — Windows, your desktop compositor,
        // browser, etc. are already using some of it. Treat it as a rough
        // ceiling to stay comfortably under, not an exact budget.
        let entry = unsafe { ash::Entry::load().ok()? };
        let app_info = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_0);
        let create_info = vk::InstanceCreateInfo::default().application_info(&app_info);
        let instance = unsafe { entry.create_instance(&create_info, None).ok()? };
        let physical_devices = unsafe { instance.enumerate_physical_devices().ok()? };

        let mut best: Option<u64> = None;
        for pd in physical_devices {
            let props = unsafe { instance.get_physical_device_properties(pd) };
            let mem_props = unsafe { instance.get_physical_device_memory_properties(pd) };
            let vram: u64 = mem_props.memory_heaps[..mem_props.memory_heap_count as usize]
                .iter()
                .filter(|h| h.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL))
                .map(|h| h.size)
                .sum();

            let is_discrete = props.device_type == vk::PhysicalDeviceType::DISCRETE_GPU;
            best = Some(vram / (1024 * 1024));
            if is_discrete {
                break; // prefer the first discrete GPU found
            }
        }

        unsafe { instance.destroy_instance(None) };
        best
    }

    use tracing_subscriber::layer::{Context, Layer};
    use tracing::field::{Field, Visit};

    pub struct BufferSizeLayer {
        pub app: AppHandle,
    }

struct MessageVisitor(String);
impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.0 = format!("{value:?}").trim_matches('"').to_string();
        }
    }
}

impl<S: tracing::Subscriber> Layer<S> for BufferSizeLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = MessageVisitor(String::new());
        event.record(&mut visitor);

        // Matches lines like:
        //   "Vulkan0 model buffer size = 3275.85 MiB"
        //   "CPU_Mapped model buffer size = 2730.00 MiB"
        if let Some(caps) = BUFFER_RE.captures(&visitor.0) {
            let backend = caps[1].to_string();
            let mib: f64 = caps[2].parse().unwrap_or(0.0);
            let _ = self.app.emit("model-buffer-size", (backend, mib));
        }
    }
}

lazy_static::lazy_static! {
    static ref BUFFER_RE: regex::Regex =
        regex::Regex::new(r"(\w+)\s+model buffer size\s*=\s*([\d.]+)\s*MiB").unwrap();
}
}

#[cfg(not(target_os = "android"))]
pub use desktop::*;

#[cfg(target_os = "android")]
mod android_stub {
    use super::ChatTurn;
    use std::sync::Mutex;
    use tauri::{AppHandle, State};

    // ← FIXED: the old stub referenced LlamaBackend / LlamaModel / Mutex /
    // DEFAULT_SYSTEM_PROMPT without importing any of them (and llama_cpp_2
    // likely isn't even compiled on Android), so an Android build would fail.
    // A unit struct is all the stub needs.
    pub struct ModelState {
        pub system_prompt: Mutex<String>,
    }

    impl ModelState {
        pub fn new() -> Self {
            Self {
                system_prompt: Mutex::new(super::DEFAULT_SYSTEM_PROMPT.to_string()),
            }
        }
    }

    pub fn load_model_internal(_path: String, _app: &tauri::AppHandle) -> Result<(), String> {
        Err("The Bible AI assistant isn't available on Android yet.".into())
    }
    pub fn unload_model_internal(_app: &tauri::AppHandle) {}

    #[tauri::command]
    pub fn load_model(_path: String, _app: AppHandle) -> Result<(), String> {
        Err("The Bible AI assistant isn't available on Android yet.".into())
    }

    #[tauri::command]
    pub fn is_model_loaded(_state: State<'_, ModelState>) -> bool {
        false
    }

    #[tauri::command]
    pub async fn chat(_prompt: String, _history: Vec<ChatTurn>, _app: AppHandle) -> Result<(), String> {
        Err("The Bible AI assistant isn't available on Android yet.".into())
    }

    #[tauri::command]
    pub fn cancel_chat(_state: State<'_, ModelState>) {}

    // #[tauri::command]
    // pub fn get_model_layer_count(_path: String) -> Result<u32, String> {
    //     Err("Not available on Android.".into())
    // }

    #[tauri::command]
    pub fn get_active_model_layer_count(_state: State<'_, ModelState>) -> Result<u32, String> {
        Err("Not available on Android.".into())
    }

    #[tauri::command]
    pub fn get_gpu_vram_mib() -> Option<u64> {
        None
    }

}

#[cfg(target_os = "android")]
pub use android_stub::*;
