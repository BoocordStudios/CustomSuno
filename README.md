# CustomSuno

A desktop workspace for [Suno](https://suno.com), with tabs, optional website plugins, themes, and local audio tools. Built with Tauri 2 and React. Available for Windows and Linux, in English and German.

## Download

Get the latest build from [Releases](https://github.com/BoocordStudios/CustomSuno/releases/latest).

| Platform | Package | Installation |
| --- | --- | --- |
| Windows x64 | `CustomSuno_*_x64-setup.exe` | Run the installer. WebView2 is installed if needed. |
| Linux x64 | `CustomSuno_*_amd64.deb` | `sudo apt install ./CustomSuno_*_amd64.deb` |
| Linux x64 | `CustomSuno_*_amd64.AppImage` | Make executable with `chmod +x`, then run. |

Linux builds target Ubuntu 22.04 or newer and compatible distributions with WebKitGTK 4.1. AppImage may require FUSE 2; alternatively run it with `--appimage-extract-and-run`. The Windows installer is unsigned.

## Features

- Suno in native browser tabs, with persistent sign-in and downloads.
- Optional compact rows, focus mode, reduced motion, media shortcut, and zoom.
- JavaScript/CSS plugins with import, editing, export, and cleanup hooks.
- Theme editor with colors, gradients, wallpapers, and custom CSS.
- Media library with waveform selection, trimming, merging, and metadata.
- Local 10-band equalizer, warmth, clarity, compression, and A/B playback.
- WAV, MP3, and M4A export; encoding runs locally.
- Settings, plugin, and theme backups.

Choose **Settings > Language** to switch between English and German. The initial language follows the system language: German for German systems, English otherwise. Website mods and themes are optional.

See [Plugins](docs/PLUGINS.md) and [Media library](docs/MEDIA_LIBRARY.md) for details.

## Development

Install Node.js 22, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. Windows requires the MSVC C++ build tools and WebView2; Linux requires WebKitGTK 4.1 and GTK 3 development libraries.

```sh
npm ci
npm run desktop
```

The browser-only preview (`npm run dev`) shows the local toolbar and panels. The Suno website runs inside the desktop app's native webviews.

```sh
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Build the Windows installer with `npm run installer`, or Linux packages with `npm run installer:linux`. Packages are written to `src-tauri/target/release/bundle/`. The GitHub Actions workflow builds both platforms and publishes a release when a `v*` tag is pushed.

## Data and limitations

The stable app identifier is `de.customsuno.desktop`. Settings and profiles are stored in the platform's application data directory; downloads go to `Downloads/CustomSuno`. App updates preserve this data. Backups contain settings, plugins, and themes, but exclude cookies and audio files. Updates are installed manually.

Audio tools process local files. Imports are limited to 150 MiB, 20 minutes, and 256 MiB of decoded PCM. New library versions use 16-bit WAV; MP3 export uses 320 kbit/s and M4A uses 256 kbit/s. Codec support for imported files depends on the platform webview.

Plugins execute in the Suno page and can access its content. Install plugins from sources you trust. Remote pages have no native Tauri permissions. Website changes may require plugin updates, and some sign-in providers may restrict embedded browsers.

CustomSuno is an independent project and is not affiliated with Suno. Access to Suno and its services remains subject to Suno's terms and account requirements.

## License

CustomSuno's original code and assets are licensed under [MIT](LICENSE). Dependencies retain their own licenses. In particular, the bundled FFmpeg WebAssembly core is GPL-2.0-or-later. See [Third-party notices](THIRD_PARTY_NOTICES.md); releases include license notices and the FFmpeg core source package.
