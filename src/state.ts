import { parseMetadata } from './media';
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings, type AudioSettings } from './audio';
import { BUILTIN_THEMES, buildSunoCss, collectThemes, parsePlugin, parseTheme, type CustomPlugin, type Theme } from './extensions';
import type { AudioFile } from './bridge';
import { systemLanguage, type Language } from './i18n';

export type AppState = {
  schemaVersion: 1;
  language: Language;
  themeId: string;
  themes: Theme[];
  plugins: CustomPlugin[];
  audio: AudioSettings;
  library: AudioFile[];
  sunoCss: string;
  volume: number;
  siteThemeEnabled: boolean;
  zoom: number;
  mods: { compact: boolean; focus: boolean; motion: boolean; shortcuts: boolean };
};
export function initialState(): AppState {
  return { schemaVersion: 1, language: systemLanguage(), themeId: 'midnight', themes: [], plugins: [], audio: { ...DEFAULT_AUDIO_SETTINGS, gains: [...DEFAULT_AUDIO_SETTINGS.gains] }, library: [], sunoCss: '', volume: 0.75, siteThemeEnabled: false, zoom: 1, mods: { compact: false, focus: false, motion: false, shortcuts: false } };
}

function extensionList<T extends { id: string }>(value: unknown, label: string, parse: (text: string) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} müssen eine Liste sein.`);
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    const result = parse(JSON.stringify(item));
    if (ids.has(result.id)) throw new Error(`${label}: Die ID „${result.id}“ ist doppelt vorhanden.`);
    ids.add(result.id);
    return result;
  });
}

function libraryFiles(value: unknown): AudioFile[] {
  if (!Array.isArray(value)) return [];
  const files: AudioFile[] = [];
  const paths = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const data = item as Record<string, unknown>;
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 1024
      || typeof data.path !== 'string' || !data.path.trim() || data.path.length > 32768
      || /[\u0000-\u001f]/.test(data.name + data.path)
      || typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size < 0
      || paths.has(data.path)) continue;
    files.push({ name: data.name, path: data.path, size: data.size, ...(data.metadata ? { metadata: parseMetadata(data.metadata) } : {}) });
    paths.add(data.path);
    if (files.length === 1000) break;
  }
  return files;
}

export function parseState(input: unknown): AppState {
  if (input == null) return initialState();
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Ungültige Einstellungsdatei.');
  const data = input as Record<string, unknown>;
  if (data.schemaVersion !== 1) throw new Error('Diese Einstellungsdatei verwendet eine unbekannte Version.');
  const state = initialState();
  if (data.language === 'de' || data.language === 'en') state.language = data.language;
  state.siteThemeEnabled = data.siteThemeEnabled === true;
  if (typeof data.zoom === 'number' && Number.isFinite(data.zoom)) state.zoom = Math.min(2, Math.max(0.5, data.zoom));
  if (data.mods && typeof data.mods === 'object') {
    const mods = data.mods as Record<string, unknown>;
    for (const key of Object.keys(state.mods) as (keyof AppState['mods'])[]) state.mods[key] = mods[key] === true;
  }
  if (typeof data.themeId === 'string' && /^(?:[a-z][a-z0-9-]{0,63}|plugin:[a-z][a-z0-9-]{0,63}:[a-z][a-z0-9-]{0,63})$/.test(data.themeId)) state.themeId = data.themeId;
  state.themes = extensionList(data.themes, 'Themes', parseTheme);
  state.plugins = extensionList(data.plugins, 'Plugins', parsePlugin);
  if (data.audio && typeof data.audio === 'object' && !Array.isArray(data.audio)) {
    state.audio = sanitizeAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, ...data.audio } as AudioSettings);
  }
  state.library = libraryFiles(data.library);
  if (data.sunoCss !== undefined) {
    if (typeof data.sunoCss !== 'string') throw new Error('Gespeicherte Suno-Styles müssen ein Text sein.');
    state.sunoCss = data.sunoCss;
  }
  if (typeof data.volume === 'number' && Number.isFinite(data.volume)) state.volume = Math.max(0, Math.min(1, data.volume));
  // Reject invalid backups inside the import/load promise, before React receives them.
  // The same validation runs when the app derives the CSS during rendering.
  const selectedTheme = collectThemes(state.themes, state.plugins).find(theme => theme.id === state.themeId) ?? BUILTIN_THEMES[0];
  buildSunoCss(selectedTheme, state.plugins, state.sunoCss);
  return state;
}
