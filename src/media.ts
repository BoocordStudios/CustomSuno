import { encodeWav } from './audio';

export type TrackMetadata = { title: string; artist: string; lyrics: string; cover: string };
export type Pcm = { channels: Float32Array[]; sampleRate: number };
export const emptyMetadata: TrackMetadata = { title: '', artist: '', lyrics: '', cover: '' };
export function parseMetadata(value: unknown): TrackMetadata {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string, max: number) => typeof data[key] === 'string' ? (data[key] as string).replace(/\u0000/g, '').slice(0, max) : '';
  const cover = text('cover', 192 * 1024);
  return { title: text('title', 200), artist: text('artist', 200), lyrics: text('lyrics', 40000), cover: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(cover) ? cover : '' };
}
export function validatePcm(pcm: Pcm): void {
  const length = pcm.channels[0]?.length ?? 0;
  if (!length || pcm.channels.length > 2 || pcm.channels.some(c => c.length !== length) || !Number.isFinite(pcm.sampleRate) || pcm.sampleRate < 8000 || pcm.sampleRate > 192000) throw new Error('Ungültige Mono-/Stereo-Audiodaten.');
  if (length / pcm.sampleRate > 1200 || length * pcm.channels.length * 4 > 256 * 1024 * 1024) throw new Error('Das Ergebnis ist zu groß (max. 20 Minuten / 256 MB dekodiertes Audio).');
}
export function trimPcm(pcm: Pcm, start: number, end: number): Pcm {
  validatePcm(pcm);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > pcm.channels[0].length / pcm.sampleRate + 1 / pcm.sampleRate || end <= start) throw new Error('Bitte einen gültigen Ausschnitt wählen: Ende muss nach Start liegen.');
  const a = Math.round(start * pcm.sampleRate), b = Math.min(pcm.channels[0].length, Math.round(end * pcm.sampleRate));
  if (a >= b) throw new Error('Der Ausschnitt ist zu kurz.');
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map(c => c.slice(a, b)) };
}
export function mergePcm(parts: Pcm[]): Pcm {
  if (parts.length < 2) throw new Error('Mindestens zwei Titel zum Zusammenfügen auswählen.');
  parts.forEach(validatePcm);
  const sampleRate = parts[0].sampleRate;
  if (parts.some(p => p.sampleRate !== sampleRate)) throw new Error('Die Audiodaten müssen zuerst auf eine gemeinsame Abtastrate dekodiert werden.');
  const count = Math.max(...parts.map(p => p.channels.length));
  const length = parts.reduce((sum, p) => sum + p.channels[0].length, 0);
  if (length / sampleRate > 1200 || length * count * 4 > 256 * 1024 * 1024) throw new Error('Die Zusammenstellung ist zu groß (max. 20 Minuten / 256 MB dekodiertes Audio).');
  const channels = Array.from({ length: count }, () => new Float32Array(length));
  let offset = 0;
  for (const part of parts) { channels.forEach((channel, i) => channel.set(part.channels[i] ?? part.channels[0], offset)); offset += part.channels[0].length; }
  return { channels, sampleRate };
}
const text = (s: string) => new TextEncoder().encode(s);
const join = (...parts: Uint8Array[]) => { const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const p of parts) { result.set(p, offset); offset += p.length; } return result; };
const syncSize = (n: number) => new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
const frame = (id: string, data: Uint8Array) => join(text(id), syncSize(data.length), new Uint8Array(2), data);
/** ID3v2.4 in a RIFF ID3 chunk: TIT2, TPE1, USLT and APIC. */
export function tagWav(wav: Uint8Array, metadata: TrackMetadata): Uint8Array {
  const m = parseMetadata(metadata), frames: Uint8Array[] = [];
  if (m.title) frames.push(frame('TIT2', join(new Uint8Array([3]), text(m.title))));
  if (m.artist) frames.push(frame('TPE1', join(new Uint8Array([3]), text(m.artist))));
  if (m.lyrics) frames.push(frame('USLT', join(new Uint8Array([3]), text('und'), new Uint8Array([0]), text(m.lyrics))));
  if (m.cover) {
    const [header, data] = m.cover.split(',');
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    frames.push(frame('APIC', join(new Uint8Array([3]), text(header.slice(5, header.indexOf(';'))), new Uint8Array([0, 3, 0]), bytes)));
  }
  if (!frames.length) return wav;
  const payload = join(...frames), tag = join(text('ID3'), new Uint8Array([4, 0, 0]), syncSize(payload.length), payload);
  const chunk = new Uint8Array(8 + tag.length + (tag.length % 2)); chunk.set(text('id3 ')); new DataView(chunk.buffer).setUint32(4, tag.length, true); chunk.set(tag, 8);
  const result = join(wav, chunk); new DataView(result.buffer).setUint32(4, result.length - 8, true); return result;
}
export function exportMedia(pcm: Pcm, metadata: TrackMetadata): Uint8Array { validatePcm(pcm); return tagWav(encodeWav(pcm.channels, pcm.sampleRate), metadata); }
