import type { Language } from './i18n';
import { EXPORT_MIME, type ExportFormat } from './audio-export';
import type { TrackMetadata } from './media';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const desktop = isTauri();
export type AudioFile = { name: string; path: string; size: number; metadata?: TrackMetadata };
const browserFiles = new Map<string, ArrayBuffer>();
const STORAGE_KEY = 'customsuno.state.v1';

export async function loadState(): Promise<unknown> {
  if (desktop) return invoke('load_state');
  const value = localStorage.getItem(STORAGE_KEY);
  return value ? JSON.parse(value) : null;
}
export async function saveState(state: unknown): Promise<void> {
  if (desktop) await invoke('save_state', { state });
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
export async function importAudio(file?: File, language: Language = 'de'): Promise<AudioFile | null> {
  if (!file && desktop) return invoke('pick_audio', { language });
  if (!file) return null;
  if (file.size > 150 * 1024 * 1024) throw new Error('Bitte eine Audiodatei unter 150 MB auswählen.');
  const entry = { name: file.name, path: `browser:${crypto.randomUUID()}`, size: file.size };
  browserFiles.set(entry.path, await file.arrayBuffer());
  return entry;
}
export async function readAudio(file: AudioFile): Promise<ArrayBuffer> {
  if (file.path.startsWith('browser:')) {
    const bytes = browserFiles.get(file.path);
    if (!bytes) throw new Error('Bitte diese Datei nach dem Browser-Neustart erneut importieren.');
    return bytes.slice(0);
  }
  if (!desktop) throw new Error('Lokale Dateien sind nur in der Desktop-App verfügbar.');
  return invoke<ArrayBuffer>('read_audio', { path: file.path });
}
export async function listDownloads(): Promise<AudioFile[]> {
  return desktop ? invoke('list_downloads') : [];
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function saveAudio(name: string, bytes: Uint8Array, format: ExportFormat, language: Language = 'de'): Promise<string | null> {
  if (desktop) return invoke('save_audio', bytes, { headers: { 'x-customsuno-filename': encodeURIComponent(name), 'x-customsuno-format': format, 'x-customsuno-language': language } });
  downloadBlob(name, new Blob([bytes], { type: EXPORT_MIME[format] }));
  return name;
}
export async function saveJson(name: string, value: unknown, language: Language = 'de'): Promise<string | null> {
  const content = JSON.stringify(value, null, 2);
  if (desktop) return invoke('save_json', { name, content, language });
  downloadBlob(name, new Blob([content], { type: 'application/json' }));
  return name;
}
export async function openSuno(themeCss: string): Promise<void> {
  if (desktop) await invoke('open_suno', { themeCss });
  else window.open('https://suno.com', '_blank', 'noopener,noreferrer');
}
export async function applySunoTheme(themeCss: string): Promise<void> {
  if (desktop) await invoke('apply_suno_theme', { themeCss });
}
export async function openFolder(kind: 'data' | 'downloads'): Promise<void> {
  if (!desktop) throw new Error('Ordner sind in der installierten Desktop-App verfügbar.');
  await invoke(kind === 'data' ? 'open_data_folder' : 'open_downloads_folder');
}
export async function openBrowser(): Promise<void> {
  if (desktop) await invoke('open_external_suno');
  else window.open('https://suno.com', '_blank', 'noopener,noreferrer');
}
export async function onDownload(callback: (file: AudioFile) => void): Promise<() => void> {
  if (!desktop) return () => {};
  return listen<AudioFile>('download-completed', (event) => callback(event.payload));
}
export async function onDownloadError(callback: (message: string) => void): Promise<() => void> {
  if (!desktop) return () => {};
  return listen<string>('download-failed', event => callback(event.payload));
}

export async function listMedia(): Promise<AudioFile[]> { return desktop ? invoke('list_media') : []; }
export async function saveMedia(name: string, bytes: Uint8Array): Promise<AudioFile> {
 if (desktop) return invoke('save_media', bytes, {headers:{'x-customsuno-filename':encodeURIComponent(name)}});
 const entry={name,path:'browser:'+crypto.randomUUID(),size:bytes.length};browserFiles.set(entry.path,bytes.slice().buffer);return entry;
}
export async function renameMedia(file: AudioFile, name: string): Promise<AudioFile> {
 if (desktop) return invoke('rename_media',{path:file.path,name});
 if (!name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new Error('Ungültiger Dateiname.');
 const extension=file.name.slice(file.name.lastIndexOf('.'));return {...file,name:name.replace(/\.[^.]+$/,'')+extension};
}
