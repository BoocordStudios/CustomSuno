use super::*;
use std::sync::atomic::AtomicBool;
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Webview, Window, WindowBuilder};

pub(crate) const TOOLBAR_HEIGHT: f64 = 96.0;
const PANEL_WIDTH: f64 = 420.0;

#[derive(Clone, Serialize)]
pub(crate) struct BrowserTab {
    id: String,
    title: String,
    loading: bool,
}

pub(crate) struct BrowserTabs {
    tabs: Vec<BrowserTab>,
    active: String,
    next_id: u64,
    zoom: f64,
}

impl Default for BrowserTabs {
    fn default() -> Self {
        Self {
            tabs: vec![BrowserTab {
                id: "suno".into(),
                title: "Suno".into(),
                loading: true,
            }],
            active: "suno".into(),
            next_id: 1,
            zoom: 1.0,
        }
    }
}

fn active_view(app: &AppHandle) -> Result<Webview, String> {
    let id = app
        .state::<RuntimeState>()
        .tabs
        .lock()
        .map_err(|e| e.to_string())?
        .active
        .clone();
    app.get_webview(&id)
        .ok_or("Suno-Tab nicht verfuegbar.".into())
}

fn update_tab(view: &Webview, update: impl FnOnce(&mut BrowserTab)) {
    if let Ok(mut tabs) = view.state::<RuntimeState>().tabs.lock() {
        if let Some(tab) = tabs.tabs.iter_mut().find(|tab| tab.id == view.label()) {
            update(tab);
        }
    }
}

fn select_tab(app: &AppHandle, id: &str) -> Result<(), String> {
    let ids: Vec<String> = {
        let state = app.state::<RuntimeState>();
        let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        if !tabs.tabs.iter().any(|tab| tab.id == id) {
            return Err("Unbekannter Tab.".into());
        }
        tabs.tabs.iter().map(|tab| tab.id.clone()).collect()
    };
    let view = app.get_webview(id).ok_or("Suno-Tab nicht verfuegbar.")?;
    view.show().map_err(|e| e.to_string())?;
    for other in ids.iter().filter(|other| other.as_str() != id) {
        if let Some(other) = app.get_webview(other) {
            other.hide().map_err(|e| e.to_string())?;
        }
    }
    app.state::<RuntimeState>()
        .tabs
        .lock()
        .map_err(|e| e.to_string())?
        .active = id.into();
    view.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_tab(
    window: Webview,
    app: AppHandle,
    action: String,
    id: Option<String>,
) -> Result<(), String> {
    require_workspace(&window)?;
    match action.as_str() {
        "new" => {
            let id = {
                let state = app.state::<RuntimeState>();
                let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
                let id = format!("suno-{}", tabs.next_id);
                tabs.next_id += 1;
                tabs.tabs.push(BrowserTab {
                    id: id.clone(),
                    title: "Suno".into(),
                    loading: true,
                });
                id
            };
            if let Err(error) = create_suno_tab(&window.window(), &id) {
                app.state::<RuntimeState>()
                    .tabs
                    .lock()
                    .map_err(|e| e.to_string())?
                    .tabs
                    .retain(|tab| tab.id != id);
                if let Some(view) = app.get_webview(&id) {
                    let _ = view.close();
                }
                return Err(error);
            }
            select_tab(&app, &id)
        }
        "select" => select_tab(&app, &id.ok_or("Tab-ID fehlt.")?),
        "close" => {
            let id = id.ok_or("Tab-ID fehlt.")?;
            let replacement = {
                let state = app.state::<RuntimeState>();
                let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
                let index = tabs
                    .tabs
                    .iter()
                    .position(|tab| tab.id == id)
                    .ok_or("Unbekannter Tab.")?;
                if tabs.tabs.len() == 1 {
                    return Err("Der letzte Suno-Tab bleibt geoeffnet.".into());
                }
                if tabs.active == id {
                    Some(tabs.tabs[if index > 0 { index - 1 } else { 1 }].id.clone())
                } else {
                    None
                }
            };
            if let Some(replacement) = replacement {
                select_tab(&app, &replacement)?;
            }
            app.get_webview(&id)
                .ok_or("Suno-Tab nicht verfuegbar.")?
                .close()
                .map_err(|e| e.to_string())?;
            app.state::<RuntimeState>()
                .tabs
                .lock()
                .map_err(|e| e.to_string())?
                .tabs
                .retain(|tab| tab.id != id);
            Ok(())
        }
        _ => Err("Unbekannte Tab-Aktion.".into()),
    }
}

fn diagnostics(builder: WebviewBuilder<tauri::Wry>, _port: u16) -> WebviewBuilder<tauri::Wry> {
    #[cfg(all(debug_assertions, target_os = "windows"))]
    if std::env::var("CUSTOMSUNO_DEBUG_WEBVIEWS").as_deref() == Ok("1") {
        return builder.additional_browser_args(&format!("--remote-debugging-port={_port}"));
    }
    builder
}

#[cfg(test)]
pub(crate) fn theme_script(css: &str) -> String {
    format!(
        "window.__customSuno?.configure({{css:{},mods:{{}},pluginIds:[]}});",
        serde_json::to_string(css).unwrap()
    )
}

fn site_script(config: &Value) -> String {
    let css = config.get("css").and_then(Value::as_str).unwrap_or("");
    let plugins = config
        .get("plugins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ids: Vec<_> = plugins
        .iter()
        .filter_map(|p| p.get("id").and_then(Value::as_str))
        .collect();
    let settings = serde_json::json!({"css":css,"mods":config.get("mods").cloned().unwrap_or(serde_json::json!({})),"pluginIds":ids});
    let mut script = include_str!("site-runtime.js").to_owned();
    script.push_str(&format!(
        "\nif(window.__customSuno){{window.__customSuno.configure({settings});"
    ));
    for plugin in plugins {
        let id = plugin
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let name = plugin.get("name").and_then(Value::as_str).unwrap_or(id);
        let code = plugin.get("script").and_then(Value::as_str).unwrap_or("");
        let meta = serde_json::json!({"id":id,"name":name});
        script.push_str(&format!(
            "\nwindow.__customSuno.install({meta},function(api){{\n{code}\n}});"
        ));
    }
    script.push_str("\n}");
    script
}

fn apply_site(app: &AppHandle) -> Result<(), String> {
    for view in app
        .webviews()
        .values()
        .filter(|view| view.label() == "suno" || view.label().starts_with("suno-"))
    {
        if is_suno_url(&view.url().map_err(|e| e.to_string())?) {
            let state = app.state::<RuntimeState>();
            let config = state.site_config.lock().map_err(|e| e.to_string())?;
            view.eval(site_script(&config)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn layout(window: &Window) -> tauri::Result<()> {
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    let state = window.state::<RuntimeState>();
    let panel = if state.panel_open.load(Ordering::Relaxed) {
        PANEL_WIDTH
    } else {
        0.0
    };
    for view in window
        .app_handle()
        .webviews()
        .values()
        .filter(|view| view.label() == "suno" || view.label().starts_with("suno-"))
    {
        view.set_bounds(tauri::Rect {
            position: LogicalPosition::new(0.0, TOOLBAR_HEIGHT).into(),
            size: LogicalSize::new(
                (size.width - panel).max(320.0),
                (size.height - TOOLBAR_HEIGHT).max(100.0),
            )
            .into(),
        })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_panel(window: Webview, app: AppHandle, open: bool) -> Result<(), String> {
    require_workspace(&window)?;
    app.state::<RuntimeState>()
        .panel_open
        .store(open, Ordering::Relaxed);
    layout(&window.window()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn configure_site(window: Webview, app: AppHandle, config: Value) -> Result<(), String> {
    require_workspace(&window)?;
    if serde_json::to_vec(&config)
        .map_err(|e| e.to_string())?
        .len()
        > 2 * 1024 * 1024
    {
        return Err("Die aktivierten Erweiterungen überschreiten 2 MB.".into());
    }
    *app.state::<RuntimeState>()
        .site_config
        .lock()
        .map_err(|e| e.to_string())? = config;
    apply_site(&app)
}

#[tauri::command]
pub async fn browser_action(window: Webview, app: AppHandle, action: String) -> Result<(), String> {
    require_workspace(&window)?;
    let view = active_view(&app)?;
    match action.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.reload(),
        "home" => view.navigate("https://suno.com".parse().unwrap()),
        _ => return Err("Unbekannte Browser-Aktion.".into()),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_status(window: Webview, app: AppHandle) -> Result<Value, String> {
    require_workspace(&window)?;
    let (tabs, active) = {
        let state = app.state::<RuntimeState>();
        let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        (tabs.tabs.clone(), tabs.active.clone())
    };
    let tabs: Vec<Value> = tabs
        .into_iter()
        .map(|tab| {
            let url = app
                .get_webview(&tab.id)
                .and_then(|view| view.url().ok())
                .map(|url| url.to_string())
                .unwrap_or_default();
            serde_json::json!({"id":tab.id,"title":tab.title,"loading":tab.loading,"url":url})
        })
        .collect();
    Ok(serde_json::json!({"tabs":tabs,"active":active}))
}

#[tauri::command]
pub async fn browser_zoom(window: Webview, app: AppHandle, zoom: f64) -> Result<(), String> {
    require_workspace(&window)?;
    if !zoom.is_finite() || !(0.5..=2.0).contains(&zoom) {
        return Err("Zoom muss zwischen 50 und 200 % liegen.".into());
    }
    app.state::<RuntimeState>()
        .tabs
        .lock()
        .map_err(|e| e.to_string())?
        .zoom = zoom;
    for view in app
        .webviews()
        .values()
        .filter(|view| view.label() == "suno" || view.label().starts_with("suno-"))
    {
        view.set_zoom(zoom).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_suno(window: Webview, app: AppHandle, theme_css: String) -> Result<(), String> {
    require_workspace(&window)?;
    apply_suno_theme(window, app, theme_css).await
}

#[tauri::command]
pub async fn apply_suno_theme(
    window: Webview,
    app: AppHandle,
    theme_css: String,
) -> Result<(), String> {
    require_workspace(&window)?;
    if theme_css.len() > MAX_THEME_BYTES {
        return Err("Theme zu groß.".into());
    }
    app.state::<RuntimeState>()
        .site_config
        .lock()
        .map_err(|e| e.to_string())?["css"] = Value::String(theme_css);
    apply_site(&app)
}

#[tauri::command]
pub async fn open_download(window: Webview, app: AppHandle, path: String) -> Result<(), String> {
    require_workspace(&window)?;
    let canonical = Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
    let root = library_dir(&app, "downloads")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("Datei liegt nicht im Download-Ordner.".into());
    }
    app.opener()
        .reveal_item_in_dir(canonical)
        .map_err(|e| e.to_string())
}

pub(crate) fn create(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = WindowBuilder::new(app, "main-window")
        .title("CustomSuno")
        .inner_size(1440.0, 960.0)
        .min_inner_size(980.0, 650.0)
        .build()?;
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    window.add_child(
        diagnostics(
            WebviewBuilder::new("main", WebviewUrl::App("index.html".into())),
            9223,
        )
        .data_directory(library_dir(app.handle(), "workspace-profile")?)
        .auto_resize()
        .on_navigation(local_workspace_url)
        .on_new_window(|_, _| NewWindowResponse::Deny),
        LogicalPosition::new(0.0, 0.0),
        size,
    )?;
    create_suno_tab(&window, "suno")?;
    Ok(())
}

fn create_suno_tab(window: &Window, id: &str) -> Result<(), String> {
    let app = window.app_handle();
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    let downloads = library_dir(app, "downloads")?;
    window.add_child(
        diagnostics(WebviewBuilder::new(id, WebviewUrl::External("https://suno.com".parse().unwrap())), 9224)
            .data_directory(library_dir(app, "suno-profile")?)
            .disable_drag_drop_handler()
            .initialization_script(include_str!("site-runtime.js"))
            .on_navigation(remote_navigation_allowed)
            .on_new_window(|url, _| if url.scheme() == "https" || url.as_str() == "about:blank" { NewWindowResponse::Allow } else { NewWindowResponse::Deny })
            .on_document_title_changed(|view, title| { update_tab(&view, |tab| tab.title = title); })
            .on_page_load(|view, payload| {
                let loading = matches!(payload.event(), PageLoadEvent::Started);
                update_tab(&view, |tab| tab.loading = loading);
                if !loading { let _ = apply_site(view.app_handle()); }
            })
            .on_download(move |view, event| {
                match event {
                    DownloadEvent::Requested { destination, url } => {
                        let name = destination.file_name().unwrap_or_default().to_string_lossy();
                        *destination = unique_audio_path(&downloads, &name);
                        let _ = view.app_handle().emit_to("main", "download-started", serde_json::json!({"name":destination.file_name().unwrap_or_default().to_string_lossy(),"url":url.as_str()}));
                    },
                    DownloadEvent::Finished { path: Some(path), success: true, .. } => {
                        match file_info(&path) {
                            Ok(file) => { let _ = view.app_handle().emit_to("main", "download-completed", file); },
                            Err(error) => { let _ = view.app_handle().emit_to("main", "download-failed", error); },
                        }
                    },
                    DownloadEvent::Finished { success: false, .. } => { let _ = view.app_handle().emit_to("main", "download-failed", "Download abgebrochen oder fehlgeschlagen."); },
                    _ => {},
                }
                true
            }),
        LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
        LogicalSize::new(size.width, size.height - TOOLBAR_HEIGHT),
    ).map_err(|e| e.to_string())?;
    let zoom = app
        .state::<RuntimeState>()
        .tabs
        .lock()
        .map_err(|e| e.to_string())?
        .zoom;
    app.get_webview(id)
        .ok_or("Suno-Tab nicht verfuegbar.")?
        .set_zoom(zoom)
        .map_err(|e| e.to_string())?;
    layout(window).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn new_panel_state() -> AtomicBool {
    AtomicBool::new(false)
}
