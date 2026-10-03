import { parseBackground, wallpaper, surfaceColor, type ThemeBackground } from './theme-background';
import { parse } from 'acorn';
import { sunoThemeTokens, themeIsLight } from './site-theme';
/** Website extensions: optional JavaScript runs inside the original Suno page. */
export type Theme = {
  id: string;
  name: string;
  description: string;
  colors: {
    background: string;
    surface: string;
    panel: string;
    accent: string;
    text: string;
    muted: string;
    line: string;
  };
  background?: ThemeBackground;
  sunoCss?: string;
};

export type Preset = {
  id: string;
  name: string;
  description: string;
  gains: number[];
  preamp: number;
  enhance: boolean;
  warmth: number;
  clarity: number;
  compression: number;
  normalize: boolean;
};

export type CustomPlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  presets: Preset[];
  themes: Theme[];
  sunoCss: string;
  script?: string;
};

export const BUILTIN_THEMES: Theme[] = [
  {
    // Keep the ID so existing installations also receive the updated default.
    id: 'midnight', name: 'Suno Orange', description: 'Dunkles Studio mit warmen orangefarbenen Akzenten im Suno-Stil.',
    colors: { background: '#111111', surface: '#1b1b1b', panel: '#262626', accent: '#ff8b1a', text: '#faf7f2', muted: '#a6a09a', line: '#363230' },
  },
  {
    id: 'lavender', name: 'Lavendel', description: 'Sanftes Violett für lange Sessions.',
    colors: { background: '#111018', surface: '#1a1824', panel: '#242032', accent: '#bba5ff', text: '#f4f0ff', muted: '#a59bb8', line: '#353044' },
  },
  {
    id: 'amber', name: 'Amber', description: 'Warmes Bernstein auf tiefem Anthrazit.',
    colors: { background: '#161310', surface: '#211c17', panel: '#2b241d', accent: '#ffca7a', text: '#fff4e5', muted: '#b2a08d', line: '#3d3228' },
  },
  {
    id: 'light', name: 'Tageslicht', description: 'Ein heller Arbeitsplatz mit grünen Akzenten.',
    colors: { background: '#f3f4ef', surface: '#ffffff', panel: '#e9ece3', accent: '#38751b', text: '#182214', muted: '#63705c', line: '#d6ddce' },
  },
];

export const BUILTIN_PRESETS: Preset[] = [
  { id: 'flat', name: 'Neutral', description: 'Unveränderter Frequenzgang ohne Enhancer.', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, enhance: false, warmth: 0, clarity: 0, compression: 0, normalize: false },
  { id: 'balanced', name: 'Studio-Balance', description: 'Dezente Wärme und Präsenz für einen ausgewogenen Mix.', gains: [1, 1.5, 1, -0.5, -0.5, 0, 0.5, 1.5, 1, 0.5], preamp: -2, enhance: true, warmth: 20, clarity: 25, compression: 25, normalize: true },
  { id: 'warm', name: 'Warme Töne', description: 'Weicher Grundton mit zurückhaltenden Höhen.', gains: [1.5, 2, 2, 1, 0, -0.5, -0.5, -1, -1.5, -2], preamp: -3, enhance: true, warmth: 55, clarity: 5, compression: 15, normalize: true },
  { id: 'vocal', name: 'Stimmen klar', description: 'Präsente Stimmen mit weniger tiefem Rumpeln.', gains: [-4, -2.5, -1, -1.5, 0, 1, 2.5, 2, 1, 0], preamp: -3, enhance: true, warmth: 10, clarity: 40, compression: 35, normalize: true },
  { id: 'bass', name: 'Satter Bass', description: 'Mehr Fundament für elektronische Musik.', gains: [3.5, 4, 2.5, 0, -1, -0.5, 0, 1, 1.5, 1], preamp: -5, enhance: true, warmth: 30, clarity: 15, compression: 25, normalize: true },
  { id: 'air', name: 'Luft & Details', description: 'Offene Höhen und feine Transienten.', gains: [-1, 0, 0, -1, -0.5, 0.5, 1, 1.5, 2.5, 3], preamp: -4, enhance: true, warmth: 10, clarity: 45, compression: 10, normalize: true },
];

const COLOR_KEYS = ['background', 'surface', 'panel', 'accent', 'text', 'muted', 'line'] as const;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CSS_LENGTH = 32 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`Ungültige Erweiterung: ${message}`);
}

function readJson(text: string): unknown {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    fail('Die JSON-Datei darf höchstens 256 KiB groß sein.');
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''), (key: string, value: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) fail(`Der Schlüssel „${key}“ ist nicht erlaubt.`);
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Ungültige Erweiterung:')) throw error;
    return fail('Die Datei enthält kein gültiges JSON.');
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} muss ein Objekt sein.`);
  return value as JsonObject;
}

function keys(value: JsonObject, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || FORBIDDEN_KEYS.has(key)) fail(`${label}: Unbekannter Schlüssel „${key}“.`);
  }
}

function schema(value: unknown): void {
  if (value !== undefined && value !== 1) fail('Es wird nur schemaVersion 1 unterstützt.');
}

function string(value: unknown, label: string, max: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(`${label} muss ein Text mit höchstens ${max} Zeichen sein.`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string): string {
  const id = string(value, label, 64);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) fail(`${label}: Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche; Beginn mit einem Buchstaben.`);
  return id;
}

function name(value: unknown, label: string): string {
  const result = string(value, label, 80);
  if (!result) fail(`${label} darf nicht leer sein.`);
  return result;
}

function number(value: unknown, label: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} muss eine endliche Zahl zwischen ${min} und ${max} sein.`);
  }
  return value;
}

function boolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(`${label} muss true oder false sein.`);
  return value;
}

/** CSS is applied only to the Suno webview. Network resources and executable legacy CSS are rejected. */
function css(value: unknown, label: string): string {
  const result = string(value, label, MAX_CSS_LENGTH, '');
  // Reject escapes/comments before inspecting keywords to prevent obfuscated identifiers.
  // Ordinary CSS comments are fine; stripping them also catches u/**/rl(...).
  const normalized = result.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/[\\\u0000]/.test(result)
    || /<\s*\/?\s*(?:script|style|iframe|object|embed|link|img|svg)\b/i.test(result)
    || /@(?:import|font-face|namespace|document)\b/i.test(normalized)
    || /\b(?:url|src|image|(?:-webkit-)?image-set|expression)\s*\(/i.test(normalized)
    || /(?:-moz-binding|behavior)\s*:/i.test(normalized)
    || /(?:https?|file|data|javascript|vbscript)\s*:/i.test(normalized)) {
    fail(`${label}: Externe Ressourcen, HTML, Escape-Sequenzen und ausführbarer Code sind nicht erlaubt.`);
  }
  return result;
}

function theme(value: unknown): Theme {
  const data = object(value, 'Theme');
  keys(data, ['schemaVersion', 'id', 'name', 'description', 'colors', 'background', 'sunoCss'], 'Theme');
  schema(data.schemaVersion);
  const sourceColors = object(data.colors, 'Theme-Farben');
  keys(sourceColors, COLOR_KEYS, 'Theme-Farben');
  const colors = {} as Theme['colors'];
  for (const key of COLOR_KEYS) {
    const color = sourceColors[key];
    if (typeof color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
      fail(`Theme-Farbe „${key}“ muss #RGB oder #RRGGBB sein.`);
    }
    colors[key] = color.toLowerCase();
  }
  const result: Theme = {
    id: identifier(data.id, 'Theme-ID'),
    name: name(data.name, 'Theme-Name'),
    description: string(data.description, 'Theme-Beschreibung', 600, ''),
    colors,
  };
  if (data.background !== undefined) result.background = parseBackground(data.background);
  if (data.sunoCss !== undefined) result.sunoCss = css(data.sunoCss, 'Theme-CSS');
  return result;
}

function preset(value: unknown): Preset {
  const data = object(value, 'Audio-Preset');
  keys(data, ['id', 'name', 'description', 'gains', 'preamp', 'enhance', 'warmth', 'clarity', 'compression', 'normalize'], 'Audio-Preset');
  if (!Array.isArray(data.gains) || data.gains.length !== 10) fail('Ein Audio-Preset braucht genau 10 EQ-Werte.');
  return {
    id: identifier(data.id, 'Preset-ID'),
    name: name(data.name, 'Preset-Name'),
    description: string(data.description, 'Preset-Beschreibung', 600, ''),
    gains: data.gains.map((gain, index) => {
      if (gain === undefined) fail(`EQ-Band ${index + 1} fehlt.`);
      return number(gain, `EQ-Band ${index + 1}`, -12, 12, 0);
    }),
    preamp: number(data.preamp, 'Vorverstärkung', -18, 12, 0),
    enhance: boolean(data.enhance, 'Enhancer', false),
    warmth: number(data.warmth, 'Wärme', 0, 100, 0),
    clarity: number(data.clarity, 'Klarheit', 0, 100, 0),
    compression: number(data.compression, 'Kompression', 0, 100, 0),
    normalize: boolean(data.normalize, 'Normalisierung', false),
  };
}

function contributions<T extends { id: string }>(value: unknown, label: string, max: number, parse: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} muss eine Liste mit höchstens ${max} Einträgen sein.`);
  const result = value.map(parse);
  const ids = new Set<string>();
  for (const item of result) {
    if (ids.has(item.id)) fail(`${label}: Die ID „${item.id}“ ist doppelt vorhanden.`);
    ids.add(item.id);
  }
  return result;
}

export function parseTheme(text: string): Theme {
  return theme(readJson(text));
}

export function parsePlugin(text: string): CustomPlugin {
  const data = object(readJson(text), 'Plugin');
  keys(data, ['schemaVersion', 'id', 'name', 'version', 'description', 'author', 'enabled', 'presets', 'themes', 'sunoCss', 'script'], 'Plugin');
  schema(data.schemaVersion);
  const version = string(data.version, 'Plugin-Version', 48);
  if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(version)) fail('Die Plugin-Version muss wie 1.0.0 aufgebaut sein.');
  const result: CustomPlugin = {
    id: identifier(data.id, 'Plugin-ID'), name: name(data.name, 'Plugin-Name'), version,
    description: string(data.description, 'Plugin-Beschreibung', 600, ''),
    author: string(data.author, 'Plugin-Autor', 80, 'Unbekannt'),
    enabled: boolean(data.enabled, 'Plugin aktiviert', true),
    presets: contributions(data.presets, 'Presets', 24, preset),
    themes: contributions(data.themes, 'Themes', 12, theme),
    sunoCss: css(data.sunoCss, 'Plugin-CSS'),
  };
  if (data.script !== undefined) {
    const code = string(data.script, 'Plugin-JavaScript', 128 * 1024);
    try {
      const program = parse(`function __customSunoPlugin(api) {\n${code}\n}`, { ecmaVersion: 'latest' });
      if (program.body.length !== 1 || program.body[0].type !== 'FunctionDeclaration') fail('Das Script muss ein gültiger Funktionsrumpf sein.');
    } catch (error) { fail(`JavaScript konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`); }
    result.script = code;
  }
  if (!result.presets.length && !result.themes.length && !result.sunoCss && !result.script) fail('Ein Plugin braucht JavaScript, CSS, ein Preset oder ein Theme.');
  return result;
}

function activePlugins(plugins: CustomPlugin[]): CustomPlugin[] {
  const seen = new Set<string>();
  return plugins.filter((plugin) => {
    if (!plugin.enabled || seen.has(plugin.id)) return false;
    seen.add(plugin.id);
    return true;
  });
}

export function collectPresets(plugins: CustomPlugin[]): Preset[] {
  return [
    ...BUILTIN_PRESETS.map((item) => ({ ...item, gains: [...item.gains] })),
    ...activePlugins(plugins).flatMap((plugin) => plugin.presets.map((item) => ({ ...item, gains: [...item.gains], id: `plugin:${plugin.id}:${item.id}` }))),
  ];
}

export function collectThemes(custom: Theme[], plugins: CustomPlugin[]): Theme[] {
  const result = BUILTIN_THEMES.map((item) => ({ ...item, colors: { ...item.colors } }));
  const seen = new Set(result.map((item) => item.id));
  for (const item of custom) {
    if (seen.has(item.id)) continue;
    result.push({ ...item, colors: { ...item.colors } });
    seen.add(item.id);
  }
  for (const plugin of activePlugins(plugins)) {
    for (const item of plugin.themes) result.push({ ...item, colors: { ...item.colors }, id: `plugin:${plugin.id}:${item.id}` });
  }
  return result;
}

export function buildSunoCss(selected: Theme, plugins: CustomPlugin[], customCss: string): string {
  // Validate again here: this function is also called with values restored from storage.
  const validated = theme({ ...selected, id: 'active-theme' });
  const color = validated.colors;
  const isLight = themeIsLight(color.background);
  const base = `/* CustomSuno: active theme */
:root, [data-theme] {
${COLOR_KEYS.map((key) => `  --customsuno-${key}: ${color[key]};`).join('\n')}
${Object.entries(sunoThemeTokens({ ...color, surface: surfaceColor(color.surface, validated.background), panel: surfaceColor(color.panel, validated.background) })).map(([key, value]) => `  ${key}: ${value} !important;`).join('\n')}
  color-scheme: ${isLight ? 'light' : 'dark'};
  accent-color: ${color.accent};
}
html, body { background-color: ${color.background} !important; color: ${color.text} !important; }
/* The home composer also uses literal colors and decorative gradients. */
[data-customsuno-composer] {
  background-color: ${surfaceColor(color.background, validated.background)} !important;
  background-image: none !important;
  color: ${color.text} !important;
}
[data-customsuno-composer] :is(h1,h2,h3,[role="heading"]) { color: ${color.text} !important; }
[data-customsuno-composer] :is(div,section,form)[class*="bg-"],
[data-customsuno-composer] :is(div,section,form)[style*="background"] {
  background-color: var(--color-background-secondary) !important;
  background-image: none !important;
}
[data-customsuno-composer] :is(div[class*="gradient"],div[style*="gradient"]) {
  background-image: none !important;
}
[data-customsuno-composer] :is(textarea,input,[contenteditable="true"]) {
  color: ${color.text} !important;
  background-color: transparent !important;
  caret-color: ${color.accent} !important;
}
[data-customsuno-composer] :is(textarea,input)::placeholder { color: ${color.muted} !important; opacity: 1 !important; }
/* Layout colors come from Suno's own semantic utilities; images and semantic error/success colors stay intact. */
::selection { background-color: ${color.accent}; color: ${color.background}; }
:focus-visible { outline-color: ${color.accent} !important; }
`;
  const backgroundCss = wallpaper(validated.background) === 'none' ? '' : `html {
    background-image: ${wallpaper(validated.background)} !important;
    background-size: ${validated.background?.fit === 'repeat' ? 'auto' : validated.background?.fit ?? 'cover'} !important;
    background-position: center !important;
    background-repeat: ${validated.background?.fit === 'repeat' ? 'repeat' : 'no-repeat'} !important;
    background-attachment: fixed !important;
  }
  body, main, .bg-background-primary, .bg-background-base, .bg-dumbo-50 {
    background-color: transparent !important;
    background-image: none !important;
  }
  :is([role="dialog"],[role="alertdialog"],[role="menu"],[data-radix-popper-content-wrapper]),
  :is([role="dialog"],[role="alertdialog"],[role="menu"],[data-radix-popper-content-wrapper]) :is(.bg-background-primary,.bg-background-base,.bg-dumbo-50) {
    background-color: ${color.background} !important;
  }`;
  return [base, backgroundCss, validated.sunoCss ?? '', ...activePlugins(plugins).map((plugin) => css(plugin.sunoCss, 'Plugin-CSS')), css(customCss, 'Eigenes CSS')].filter(Boolean).join('\n');
}
