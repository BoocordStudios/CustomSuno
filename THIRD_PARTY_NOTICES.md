# Third-party notices

The MIT license in this repository covers CustomSuno's original source and assets. It does not replace the licenses of dependencies, Suno's website, or user-provided content.

## FFmpeg WebAssembly

Local MP3 and M4A export uses the unmodified single-threaded `@ffmpeg/core` 0.12.10 package, licensed under **GPL-2.0-or-later**. The separate `@ffmpeg/ffmpeg` JavaScript wrapper is MIT licensed. See the [upstream licensing explanation](https://ffmpegwasm.netlify.app/docs/faq/#what-is-the-license-of-ffmpegwasm).

The core source release is [upstream commit 71aa99d37c02a7b4c435275ca9ef50e612f6efa1](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1), including build scripts, bindings, and its Dockerfile. It uses FFmpeg 5.1.4 and external codec libraries with their own notices. Each CustomSuno release includes an `ffmpeg-core-0.12.10-source.tar.gz` asset with that source, dependency sources, build instructions, and their original license files. The GPL text is included in `public/licenses/GPL-2.0.txt` and in installed packages. This component is provided without warranty; its licenses permit modification and redistribution under their respective terms.

## Fonts and other dependencies

DM Sans is distributed under the SIL Open Font License 1.1, included in `public/licenses/DM-Sans-OFL.txt`. React, Lucide, Acorn, Tauri, and other dependencies retain their upstream licenses. Build preparation collects dependency attribution and available license texts into `public/licenses/`; these are bundled with the application. Exact versions are recorded in `package-lock.json` and `src-tauri/Cargo.lock`.

Linux AppImages also include system libraries selected by Tauri's bundler, such as WebKitGTK, GTK, and GStreamer. Their upstream notices remain in the package. The Debian package uses distribution-managed system libraries.
