mod media;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, Manager, State, Webview, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

const MAX_AUDIO_BYTES: u64 = 150 * 1024 * 1024;
const MAX_STATE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_THEME_BYTES: usize = 256 * 1024;
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "webm",
];
static DOWNLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct RuntimeState {
    tabs: Mutex<browser::BrowserTabs>,
    site_config: Mutex<Value>,
    panel_open: std::sync::atomic::AtomicBool,
    state_io: Mutex<()>,
}

#[derive(Clone, Serialize)]
struct AudioFile {
    name: String,
    path: String,
    size: u64,
}

#[derive(Serialize)]
struct AppPaths {
    data: String,
    downloads: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn library_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let path = if name == "downloads" {
        app.path()
            .download_dir()
            .map_err(|e| e.to_string())?
            .join("CustomSuno")
    } else {
        data_dir(app)?.join(name)
    };
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn local_workspace_url(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
            && url.port() == Some(1420))
}

// A capability alone is not enough for custom Rust commands: verify the actual
// caller's window and origin for every entry point, including read-only commands.
fn require_workspace(window: &Webview) -> Result<(), String> {
    if window.label() == "main" && local_workspace_url(&window.url().map_err(|e| e.to_string())?) {
        Ok(())
    } else {
        Err("Native Funktionen stehen nur im lokalen CustomSuno-Fenster zur Verfügung.".into())
    }
}

fn is_suno_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| host == "suno.com" || host.ends_with(".suno.com"))
}

fn remote_navigation_allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        || url.as_str() == "about:blank"
        || (url.scheme() == "blob"
            && url
                .as_str()
                .strip_prefix("blob:")
                .and_then(|inner| inner.parse::<tauri::Url>().ok())
                .is_some_and(|inner| is_suno_url(&inner)))
}

fn read_limited(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err(format!(
            "Datei zu groß oder ungültig (maximal {} MiB).",
            max_bytes / 1024 / 1024
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err("Die Datei hat die erlaubte Größe überschritten.".into());
    }
    Ok(bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Ungültiger Speicherpfad.")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_state_file(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&read_limited(path, MAX_STATE_BYTES)?).map_err(|e| e.to_string())
}

fn recover_state(directory: &Path) -> Result<Value, String> {
    let primary = directory.join("workspace.json");
    let backup = directory.join("workspace.backup.json");
    if !primary.exists() && !backup.exists() {
        return Ok(Value::Null);
    }
    if let Ok(value) = read_state_file(&primary) {
        return Ok(value);
    }
    let recovered = read_state_file(&backup)
        .map_err(|_| "Die Einstellungen konnten nicht gelesen werden. workspace.json und die Sicherung im Datenordner prüfen.".to_owned())?;
    // Repair the primary while retaining the good backup.
    atomic_write(
        &primary,
        &serde_json::to_vec_pretty(&recovered).map_err(|e| e.to_string())?,
    )?;
    Ok(recovered)
}

fn persist_state(directory: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err("Die Einstellungen überschreiten 8 MiB.".into());
    }
    let primary = directory.join("workspace.json");
    let backup = directory.join("workspace.backup.json");
    if let Ok(previous) = read_state_file(&primary) {
        atomic_write(
            &backup,
            &serde_json::to_vec_pretty(&previous).map_err(|e| e.to_string())?,
        )?;
    } else if !backup.exists() {
        atomic_write(&backup, &bytes)?;
    }
    atomic_write(&primary, &bytes)
}

#[tauri::command]
fn load_state(
    window: Webview,
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<Value, String> {
    require_workspace(&window)?;
    let _guard = state.state_io.lock().map_err(|e| e.to_string())?;
    recover_state(&data_dir(&app)?)
}

#[tauri::command]
fn save_state(
    window: Webview,
    app: AppHandle,
    runtime: State<'_, RuntimeState>,
    state: Value,
) -> Result<(), String> {
    require_workspace(&window)?;
    let _guard = runtime.state_io.lock().map_err(|e| e.to_string())?;
    persist_state(&data_dir(&app)?, &state)
}

fn audio_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| AUDIO_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
}

fn audio_info(path: &Path) -> Result<AudioFile, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || !audio_extension(path) {
        return Err("Bitte eine unterstützte Audiodatei auswählen.".into());
    }
    if metadata.len() > MAX_AUDIO_BYTES {
        return Err("Audiodateien dürfen höchstens 150 MiB groß sein.".into());
    }
    Ok(AudioFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
    })
}

fn safe_filename(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("audio.wav");
    let sanitized: String = leaf
        .chars()
        .take(180)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches([' ', '.']);
    if sanitized.is_empty() {
        "audio.wav".into()
    } else {
        sanitized.into()
    }
}

fn unique_audio_path(directory: &Path, name: &str) -> PathBuf {
    let name = safe_filename(name);
    let path = Path::new(&name);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let extension = path
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default();
    static RESERVED: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    let mut reserved = RESERVED
        .get_or_init(|| Mutex::new(std::collections::HashSet::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let original = directory.join(&name);
    if !original.exists() && reserved.insert(original.to_string_lossy().to_lowercase()) {
        return original;
    }
    loop {
        let sequence = DOWNLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = directory.join(format!("{stem}-{sequence}{extension}"));
        if !candidate.exists() && reserved.insert(candidate.to_string_lossy().to_lowercase()) {
            return candidate;
        }
    }
}

fn authorized_audio_path(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !audio_extension(&canonical) {
        return Err("Dieses Dateiformat wird nicht unterstützt.".into());
    }
    let authorized = roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| canonical.starts_with(root));
    if !authorized {
        return Err(
            "Die Datei liegt nicht in der CustomSuno-Bibliothek. Bitte zuerst importieren.".into(),
        );
    }
    audio_info(&canonical)?;
    Ok(canonical)
}

#[tauri::command]
async fn pick_audio(
    window: Webview,
    app: AppHandle,
    language: Option<String>,
) -> Result<Option<AudioFile>, String> {
    require_workspace(&window)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title(if language.as_deref() == Some("en") {
            "Import audio into CustomSuno"
        } else {
            "Audio in CustomSuno importieren"
        })
        .add_filter("Audio", AUDIO_EXTENSIONS)
        .pick_file()
        .await;
    let Some(file) = selection else {
        return Ok(None);
    };
    audio_info(file.path())?;
    let bytes = read_limited(file.path(), MAX_AUDIO_BYTES)?;
    let directory = library_dir(&app, "imported")?;
    let destination = unique_audio_path(&directory, &file.file_name());
    // create_new prevents even a racing second import from overwriting a file.
    let mut target = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&destination)
        .map_err(|e| e.to_string())?;
    target.write_all(&bytes).map_err(|e| e.to_string())?;
    target.sync_all().map_err(|e| e.to_string())?;
    audio_info(&destination).map(Some)
}

#[tauri::command]
async fn read_audio(
    window: Webview,
    app: AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    require_workspace(&window)?;
    let canonical = authorized_audio_path(
        Path::new(&path),
        &[
            library_dir(&app, "downloads")?,
            library_dir(&app, "imported")?,
        ],
    )?;
    // Binary IPC avoids serializing every sample as a JSON number.
    Ok(tauri::ipc::Response::new(read_limited(
        &canonical,
        MAX_AUDIO_BYTES,
    )?))
}

fn validate_audio_export(bytes: &[u8], format: &str) -> Result<(), String> {
    let valid = match format {
        "wav" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE",
        "mp3" => {
            bytes.starts_with(b"ID3")
                || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
        }
        "m4a" => bytes.len() >= 12 && &bytes[4..8] == b"ftyp",
        _ => return Err("Unterstützte Exportformate: WAV, MP3 und M4A.".into()),
    };
    if !valid || bytes.len() as u64 > MAX_AUDIO_BYTES {
        return Err(format!(
            "Der Export muss eine gültige {}-Datei mit höchstens 150 MiB sein.",
            format.to_uppercase()
        ));
    }
    Ok(())
}

#[tauri::command]
async fn save_audio(
    window: Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    require_workspace(&window)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("Der Audioexport benötigt binäre Audiodaten.".into()),
    };
    let encoded_name = request
        .headers()
        .get("x-customsuno-filename")
        .map(|value| value.to_str())
        .transpose()
        .map_err(|_| "Der Export-Dateiname konnte nicht gelesen werden.")?
        .unwrap_or("CustomSuno-enhanced.wav");
    if encoded_name.len() > 2048 {
        return Err("Der Export-Dateiname ist zu lang.".into());
    }
    let name = percent_encoding::percent_decode_str(encoded_name)
        .decode_utf8()
        .map_err(|_| "Der Export-Dateiname enthält ungültige Zeichen.")?;
    let format = request
        .headers()
        .get("x-customsuno-format")
        .map(|value| value.to_str())
        .transpose()
        .map_err(|_| "Ungültiges Exportformat.")?
        .unwrap_or("wav");
    validate_audio_export(bytes, format)?;
    let name = Path::new(&safe_filename(&name))
        .with_extension(format)
        .to_string_lossy()
        .into_owned();
    let selection = rfd::AsyncFileDialog::new()
        .set_title(
            if request
                .headers()
                .get("x-customsuno-language")
                .is_some_and(|value| value == "en")
            {
                "Export edited audio"
            } else {
                "Bearbeitetes Audio exportieren"
            },
        )
        .set_file_name(&name)
        .add_filter(format.to_uppercase(), &[format])
        .save_file()
        .await;
    let Some(file) = selection else {
        return Ok(None);
    };
    let destination = file.path();
    if !destination
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(format))
    {
        return Err(format!("Bitte eine Datei mit der Endung .{format} wählen."));
    }
    atomic_write(destination, bytes)?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_json(
    window: Webview,
    name: String,
    content: String,
    language: Option<String>,
) -> Result<Option<String>, String> {
    require_workspace(&window)?;
    if content.len() > 2 * 1024 * 1024 {
        return Err("JSON-Exporte dürfen höchstens 2 MiB groß sein.".into());
    }
    serde_json::from_str::<Value>(&content).map_err(|e| format!("Ungültiges JSON: {e}"))?;
    let name = Path::new(&safe_filename(&name))
        .with_extension("json")
        .to_string_lossy()
        .into_owned();
    let selection = rfd::AsyncFileDialog::new()
        .set_title(if language.as_deref() == Some("en") {
            "Export CustomSuno file"
        } else {
            "CustomSuno-Datei exportieren"
        })
        .set_file_name(&name)
        .add_filter("JSON", &["json"])
        .save_file()
        .await;
    let Some(file) = selection else {
        return Ok(None);
    };
    let destination = file.path();
    if !destination
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("Bitte eine Datei mit der Endung .json wählen.".into());
    }
    atomic_write(destination, content.as_bytes())?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[tauri::command]
fn list_downloads(window: Webview, app: AppHandle) -> Result<Vec<AudioFile>, String> {
    require_workspace(&window)?;
    let mut files: Vec<_> = fs::read_dir(library_dir(&app, "downloads")?)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| file_info(&entry.path()).ok())
        .collect();
    files.sort_by_key(|file| file.name.to_lowercase());
    Ok(files)
}

#[tauri::command]
fn get_app_paths(window: Webview, app: AppHandle) -> Result<AppPaths, String> {
    require_workspace(&window)?;
    Ok(AppPaths {
        data: data_dir(&app)?.to_string_lossy().into_owned(),
        downloads: library_dir(&app, "downloads")?
            .to_string_lossy()
            .into_owned(),
    })
}

#[tauri::command]
fn open_data_folder(window: Webview, app: AppHandle) -> Result<(), String> {
    require_workspace(&window)?;
    app.opener()
        .open_path(data_dir(&app)?.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_downloads_folder(window: Webview, app: AppHandle) -> Result<(), String> {
    require_workspace(&window)?;
    app.opener()
        .open_path(
            library_dir(&app, "downloads")?.to_string_lossy(),
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external_suno(window: Webview, app: AppHandle) -> Result<(), String> {
    require_workspace(&window)?;
    app.opener()
        .open_url("https://suno.com", None::<&str>)
        .map_err(|e| e.to_string())
}

mod browser;

fn file_info(path: &Path) -> Result<AudioFile, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Kein Dateidownload.".into());
    }
    Ok(AudioFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RuntimeState {
            tabs: Mutex::default(),
            site_config: Mutex::new(serde_json::json!({"css":"","mods":{},"plugins":[]})),
            state_io: Mutex::new(()),
            panel_open: browser::new_panel_state(),
        })
        .on_window_event(|window, event| {
            if window.label() == "main-window" {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    window.app_handle().exit(0);
                }
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                ) {
                    let _ = browser::layout(window);
                }
            }
        })
        .setup(browser::create)
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            pick_audio,
            read_audio,
            save_audio,
            save_json,
            list_downloads,
            media::list_media,
            media::rename_media,
            media::save_media,
            get_app_paths,
            open_data_folder,
            open_downloads_folder,
            open_external_suno,
            browser::open_suno,
            browser::apply_suno_theme,
            browser::set_panel,
            browser::configure_site,
            browser::browser_tab,
            browser::browser_action,
            browser::browser_status,
            browser::browser_zoom,
            browser::open_download
        ])
        .run(tauri::generate_context!())
        .expect("CustomSuno konnte nicht gestartet werden");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn corrupt_primary_recovers_previous_saved_state() {
        let dir = tempfile::tempdir().unwrap();
        persist_state(dir.path(), &json!({"theme": "first"})).unwrap();
        persist_state(dir.path(), &json!({"theme": "second"})).unwrap();
        fs::write(dir.path().join("workspace.json"), "corrupted").unwrap();
        assert_eq!(
            recover_state(dir.path()).unwrap(),
            json!({"theme": "first"})
        );
        assert_eq!(
            read_state_file(&dir.path().join("workspace.json")).unwrap(),
            json!({"theme": "first"})
        );
    }

    #[test]
    fn audio_export_rejects_mismatched_formats_and_invalid_headers() {
        let wav = b"RIFF\0\0\0\0WAVE";
        let mp3 = b"ID3\x04\0\0\0\0\0\0";
        let m4a = b"\0\0\0\x18ftypM4A ";
        for (bytes, format) in [
            (wav.as_slice(), "wav"),
            (mp3.as_slice(), "mp3"),
            (m4a.as_slice(), "m4a"),
        ] {
            assert!(validate_audio_export(bytes, format).is_ok());
            assert!(validate_audio_export(b"", format).is_err());
        }
        assert!(validate_audio_export(wav, "mp3").is_err());
        assert!(validate_audio_export(mp3, "m4a").is_err());
        assert!(validate_audio_export(m4a, "wav").is_err());
        assert!(validate_audio_export(wav, "exe").is_err());
    }

    #[test]
    fn fresh_install_has_no_saved_state() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(recover_state(dir.path()).unwrap(), Value::Null);
    }

    #[test]
    fn library_scope_blocks_traversal_and_non_audio_files() {
        let dir = tempfile::tempdir().unwrap();
        let library = dir.path().join("downloads");
        fs::create_dir(&library).unwrap();
        fs::write(library.join("song.wav"), b"audio").unwrap();
        fs::write(dir.path().join("outside.wav"), b"secret").unwrap();
        fs::write(library.join("secret.txt"), b"secret").unwrap();
        let roots = [library.clone()];
        assert!(authorized_audio_path(&library.join("song.wav"), &roots).is_ok());
        assert!(authorized_audio_path(&library.join("../outside.wav"), &roots).is_err());
        assert!(authorized_audio_path(&library.join("secret.txt"), &roots).is_err());
    }

    #[test]
    fn suno_host_check_rejects_lookalike_domains() {
        assert!(is_suno_url(&"https://suno.com/create".parse().unwrap()));
        assert!(is_suno_url(&"https://www.suno.com/".parse().unwrap()));
        assert!(!is_suno_url(
            &"https://suno.com.example.org/".parse().unwrap()
        ));
        assert!(!is_suno_url(&"http://suno.com/".parse().unwrap()));
        assert!(!local_workspace_url(&"https://suno.com/".parse().unwrap()));
    }

    #[test]
    fn theme_is_serialized_as_data_and_filenames_cannot_escape_directory() {
        let css = "body { content: \"';alert(1);//\"; }\n";
        assert!(browser::theme_script(css).contains(&serde_json::to_string(css).unwrap()));
        assert_eq!(safe_filename("../../audio.wav"), "audio.wav");
        assert_eq!(safe_filename("..\\audio.wav"), "audio.wav");
        assert!(!safe_filename("a:b?.wav").contains(':'));
    }
}
