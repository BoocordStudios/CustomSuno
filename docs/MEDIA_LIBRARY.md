# Media library

The library contains downloads, imported audio, and saved edits. Desktop imports copy files into the app profile; external originals remain intact.

- **Edit:** play audio, inspect its waveform, select a time range, preview it, and keep the selection. The last trim can be undone.
- **Merge:** add tracks, arrange their order, and join them sequentially without crossfades. Mono tracks are duplicated into both channels when merged with stereo.
- **Rename:** change a library filename while preserving its extension. Existing files are never overwritten.
- **Metadata:** edit title, artist, artwork, and lyrics. Existing library entries store metadata in the app profile; source tags are unchanged.
- **Save a new version:** create a 16-bit, 48 kHz WAV in the library, optionally opening the equalizer afterward.
- **Export:** save WAV, MP3 (320 kbit/s), or M4A/AAC (256 kbit/s). Encoding runs locally.

Results are limited to 20 minutes and 256 MiB decoded PCM; source files to 150 MiB. Save or discard pending edits before switching panels. Unsaved audio is not restored after closing the app.

Artwork is resized and saved as JPEG. WAV exports can include title, artist, lyrics, and artwork in an ID3 chunk; support varies between players. Metadata from imported files is not automatically read.

In the browser-only preview, imported audio lasts for the current session. The desktop app stores library files and metadata persistently.
