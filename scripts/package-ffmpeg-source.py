"""Package the bundled FFmpeg core's upstream sources and build instructions."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.parse
import urllib.request

COMMIT = "71aa99d37c02a7b4c435275ca9ef50e612f6efa1"
RELEASE_DATE = "2025-01-07T10:12:48Z"
SOURCES = [
    ("ffmpeg.wasm", "ffmpegwasm/ffmpeg.wasm", COMMIT),
    ("FFmpeg", "FFmpeg/FFmpeg", "n5.1.4"),
    ("x264", "ffmpegwasm/x264", "4-cores"),
    ("x265", "ffmpegwasm/x265", "3.4"),
    ("libvpx", "ffmpegwasm/libvpx", "v1.13.1"),
    ("lame", "ffmpegwasm/lame", "master"),
    ("ogg", "ffmpegwasm/Ogg", "v1.3.4"),
    ("theora", "ffmpegwasm/theora", "v1.1.1"),
    ("opus", "ffmpegwasm/opus", "v1.3.1"),
    ("vorbis", "ffmpegwasm/vorbis", "v1.3.3"),
    ("zlib", "ffmpegwasm/zlib", "v1.2.11"),
    ("libwebp", "ffmpegwasm/libwebp", "v1.3.2"),
    ("freetype2", "ffmpegwasm/freetype2", "VER-2-10-4"),
    ("fribidi", "fribidi/fribidi", "v1.0.9"),
    ("harfbuzz", "harfbuzz/harfbuzz", "5.2.0"),
    ("libass", "libass/libass", "0.15.0"),
    ("zimg", "sekrit-twc/zimg", "release-3.0.5"),
    ("SDL2", "libsdl-org/SDL", "release-2.24.2"),
    ("emscripten", "emscripten-core/emscripten", "3.1.40"),
]
destination = Path("release/ffmpeg-core-0.12.10-source")
destination.mkdir(parents=True, exist_ok=True)

def download(url, authenticated=False):
    headers = {"User-Agent": "CustomSuno-source-packager"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if authenticated and token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=180) as response:
        return response.read()

def archive(source):
    name, repository, ref = source
    # Moving branches are resolved to their last commit at the core release date.
    if name in {"x264", "lame"}:
        query = urllib.parse.urlencode({"sha": ref, "until": RELEASE_DATE, "per_page": 1})
        ref = json.loads(download(f"https://api.github.com/repos/{repository}/commits?{query}", True))[0]["sha"]
    url = f"https://codeload.github.com/{repository}/tar.gz/{ref}"
    data = download(url)
    filename = f"{name}.tar.gz"
    (destination / filename).write_bytes(data)
    print(f"Downloaded {name}", flush=True)
    return {"name": name, "repository": repository, "ref": ref, "url": url, "archive": filename, "sha256": hashlib.sha256(data).hexdigest()}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    manifest = list(executor.map(archive, SOURCES))
(destination / "SOURCES.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
(destination / "README.md").write_text("""# FFmpeg core 0.12.10 source

CustomSuno bundles the unmodified @ffmpeg/core 0.12.10 single-threaded WASM encoder. This archive contains upstream sources, original notices, and build scripts. See SOURCES.json for source locations and SHA-256 checksums. Each nested source archive retains its own license.

Extract ffmpeg.wasm.tar.gz to find Dockerfile, Makefile, build/, and src/ at upstream commit 71aa99d37c02a7b4c435275ca9ef50e612f6efa1. The core uses FFmpeg n5.1.4, Emscripten 3.1.40, and the dependencies recorded by that Dockerfile. SDL2 2.24.2 is the SDK's SDL2 port. Moving source branches are pinned at the upstream release date.

With Docker Buildx installed, follow the upstream Makefile's build-st target to rebuild the single-threaded core. The Dockerfile contains compiler flags and linking instructions. The included dependency archives provide local copies of sources referenced by that build; replace its Git ADD/clone inputs with extracted source directories if building offline. The Emscripten SDK is an external build tool, available from https://github.com/emscripten-core/emsdk/tree/3.1.40.

The WASM core is GPL-2.0-or-later, with external library licenses retained. It is provided without warranty. CustomSuno's MIT license does not relicense this component.
""", encoding="utf-8")
with tarfile.open("release/ffmpeg-core-0.12.10-source.tar.gz", "w:gz") as output:
    output.add(destination, arcname=destination.name)
print("Packaged FFmpeg core sources.", flush=True)
