# Validation

Run these checks before publishing a release:

```sh
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The release workflow tests and builds Windows x64 and Linux x64 independently. Linux packages are built on Ubuntu 22.04 to keep the minimum glibc requirement compatible with that baseline. A Linux startup check runs the packaged executable under Xvfb before publication.

Manual checks should cover:

- English/German switching, persistence, and backup restore.
- Tabs, navigation, window resizing, and opening/closing each tool panel.
- Plugin install, enable/disable, dynamic DOM updates, and cleanup.
- Theme changes, reset, import/export, and wallpaper preview.
- Audio import, playback, trimming, merging, metadata, and all export formats.
- Downloads and native file dialogs.
- Rejection of native commands from remote webviews.

Website access, OAuth providers, and audio decoding depend on external services and the platform webview. A successful build or startup check does not verify every Suno account flow.
