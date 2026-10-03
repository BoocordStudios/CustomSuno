import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { TrackMetadata } from './media';

export type ExportFormat = 'wav' | 'mp3' | 'm4a';
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'wav', label: 'WAV · 16 Bit' },
  { value: 'mp3', label: 'MP3 · 320 kbit/s' },
  { value: 'm4a', label: 'M4A (AAC) · 256 kbit/s' },
];
export const EXPORT_MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' };

export async function encodeExport(wav: Uint8Array, format: ExportFormat, onProgress?: (message: string) => void, metadata?: TrackMetadata): Promise<Uint8Array> {
  if (format === 'wav') return wav;
  const encoder = new FFmpeg();
  try {
    onProgress?.(`${format.toUpperCase()}-Encoder laden …`);
    const base = new URL('/audio-codecs/', location.href);
    await encoder.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL: new URL('ffmpeg-core.wasm', base).href });
    onProgress?.(`${format.toUpperCase()} wird kodiert …`);
    encoder.on('progress', ({ progress }) => onProgress?.(`${format.toUpperCase()} wird kodiert … ${Math.min(100, Math.max(0, Math.round(progress * 100)))} %`));
    // writeFile transfers its buffer; retain the caller's WAV data.
    await encoder.writeFile('input.wav', wav.slice());
    const output = `output.${format}`;
    const codec = format === 'mp3'
      ? ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3']
      : ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'];
    // The MP4 muxer expects "lyrics", whereas WAV/ID3 exposes "lyrics-und".
    const tags = metadata?.lyrics ? ['-metadata', `lyrics=${metadata.lyrics}`] : [];
    const result = await encoder.exec(['-i', 'input.wav', '-map', '0:a:0', '-map', '0:v?', '-map_metadata', '0', '-c:v', 'copy', '-disposition:v', 'attached_pic', ...codec, ...tags, output]);
    if (result !== 0) throw new Error(`${format.toUpperCase()} konnte nicht kodiert werden.`);
    const bytes = await encoder.readFile(output);
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Der Audioexport ist leer.');
    return bytes;
  } finally {
    // Release the WASM heap and temporary files, including after failures.
    encoder.terminate();
  }
}
