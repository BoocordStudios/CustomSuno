# Native architecture

The `main-window` contains a local `main` webview for the toolbar and panels, plus one remote webview per Suno tab. The toolbar and tab bar occupy 96 logical pixels. Opening a panel reduces the active Suno webview's width by 420 logical pixels.

Resize and DPI changes update child webview bounds. Only `main` has native capabilities. Commands validate both the calling webview's label and its current URL. Remote pages have no native permissions.

The injected `site-runtime.js` handles optional mods, plugin lifecycle, styles, navigation, storage, and cleanup. All Suno tabs share the persistent `suno-profile`.

Downloads go to the system download directory under `CustomSuno`. Audio imports are copied to the app data directory. Native audio access checks canonical paths and file types. Settings use atomic JSON writes with a backup file.

WebView2 is used on Windows; WebKitGTK 4.1 is used on Linux. Multiple child webviews require Tauri's `unstable` feature. Dependency versions are locked in `Cargo.lock`.

Windows-only WebView2 diagnostics can be enabled in debug builds with `CUSTOMSUNO_DEBUG_WEBVIEWS=1`. Ports 9223 and 9224 are intended for local development only.
