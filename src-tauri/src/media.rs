use super::*;

#[tauri::command]
pub fn list_media(window: Webview, app: AppHandle) -> Result<Vec<AudioFile>, String> {
    require_workspace(&window)?;
    let mut files = Vec::new();
    for kind in ["downloads", "imported"] {
        files.extend(
            fs::read_dir(library_dir(&app, kind)?)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .filter_map(|entry| file_info(&entry.path()).ok()),
        );
    }
    files.sort_by_key(|f| f.name.to_lowercase());
    Ok(files)
}

fn rename_in_library(path: &Path, roots: &[PathBuf], name: &str) -> Result<AudioFile, String> {
    let source = authorized_audio_path(path, roots)?;
    if name.is_empty() || safe_filename(name) != name {
        return Err(
            "Bitte einen gültigen Dateinamen ohne Pfad oder Sonderzeichen eingeben.".into(),
        );
    }
    let mut leaf = PathBuf::from(name);
    leaf.set_extension(source.extension().unwrap_or_default());
    let destination = source.parent().ok_or("Dateiordner fehlt.")?.join(leaf);
    if source == destination {
        return audio_info(&source);
    }
    if destination.exists() {
        return Err("Eine Datei mit diesem Namen existiert bereits.".into());
    }
    // Windows rename fails if the destination already exists; never replace a track.
    fs::rename(&source, &destination).map_err(|e| e.to_string())?;
    audio_info(&path.with_file_name(destination.file_name().ok_or("Dateiname fehlt.")?))
}

#[tauri::command]
pub fn rename_media(
    window: Webview,
    app: AppHandle,
    path: String,
    name: String,
) -> Result<AudioFile, String> {
    require_workspace(&window)?;
    rename_in_library(
        Path::new(&path),
        &[
            library_dir(&app, "downloads")?,
            library_dir(&app, "imported")?,
        ],
        &name,
    )
}

#[tauri::command]
pub fn save_media(
    window: Webview,
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<AudioFile, String> {
    require_workspace(&window)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("Binäre WAV-Daten fehlen.".into()),
    };
    let encoded = request
        .headers()
        .get("x-customsuno-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Bearbeitet.wav");
    if encoded.len() > 2048 {
        return Err("Dateiname zu lang.".into());
    }
    let name = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let directory = library_dir(&app, "imported")?;
    store_wav(&directory, &name, bytes)
}

fn store_wav(directory: &Path, name: &str, bytes: &[u8]) -> Result<AudioFile, String> {
    if bytes.len() < 44
        || bytes.len() as u64 > MAX_AUDIO_BYTES
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || u32::from_le_bytes(bytes[4..8].try_into().map_err(|_| "WAV-Header fehlt.")?) as usize + 8
            != bytes.len()
    {
        return Err("Bitte eine gültige WAV-Datei bis 150 MB speichern.".into());
    }
    let name = Path::new(&safe_filename(name)).with_extension("wav");
    let destination = unique_audio_path(directory, &name.to_string_lossy());
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&destination)
        .map_err(|e| e.to_string())?;
    let result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&destination);
        return Err(error.to_string());
    }
    audio_info(&destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn media_copies_are_unique_and_preserve_wav_bytes() {
        let root = tempfile::tempdir().unwrap();
        let mut bytes = vec![0u8; 44];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[4..8].copy_from_slice(&36u32.to_le_bytes());
        bytes[8..12].copy_from_slice(b"WAVE");
        let first = store_wav(root.path(), "track.wav", &bytes).unwrap();
        let second = store_wav(root.path(), "track.wav", &bytes).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(fs::read(first.path).unwrap(), bytes);
        assert_eq!(fs::read(second.path).unwrap(), bytes);
        assert!(store_wav(root.path(), "bad.wav", b"invalid").is_err());
        bytes[4] = 0;
        assert!(store_wav(root.path(), "bad.wav", &bytes).is_err());
    }
    #[test]
    fn rename_preserves_bytes_and_rejects_escape_and_collision() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("original.wav");
        fs::write(&source, b"audio-data").unwrap();
        let roots = [root.path().to_path_buf()];
        assert!(rename_in_library(&source, &roots, "../escape.wav").is_err());
        fs::write(root.path().join("existing.wav"), b"keep").unwrap();
        assert!(rename_in_library(&source, &roots, "existing.wav").is_err());
        let renamed = rename_in_library(&source, &roots, "renamed.wav").unwrap();
        assert_eq!(fs::read(&renamed.path).unwrap(), b"audio-data");
        assert!(!source.exists());
        assert_eq!(fs::read(root.path().join("existing.wav")).unwrap(), b"keep");
    }
}
