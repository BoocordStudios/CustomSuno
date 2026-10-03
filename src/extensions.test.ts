import { describe, expect, it } from 'vitest';
import themeExample from '../examples/ocean.theme.json';
import pluginExample from '../examples/studio-essentials.plugin.json';
import {
  BUILTIN_PRESETS, BUILTIN_THEMES, buildSunoCss, collectPresets, collectThemes, parsePlugin, parseTheme,
} from './extensions';

const themeFile = JSON.stringify(themeExample);
const pluginFile = JSON.stringify(pluginExample);

function pluginWith(change: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(pluginFile), ...change });
}

describe('declarative extension imports', () => {
  it('loads the shipped examples and all built-in themes', () => {
    expect(parseTheme(themeFile).id).toBe('ocean');
    expect(parsePlugin(pluginFile).presets).toHaveLength(2);
    for (const theme of BUILTIN_THEMES) expect(parseTheme(JSON.stringify(theme))).toEqual(theme);
    for (const preset of BUILTIN_PRESETS) {
      expect(parsePlugin(pluginWith({ presets: [preset] })).presets[0]).toEqual(preset);
    }
  });

  it('accepts a UTF-8 BOM and defaults optional fields explicitly', () => {
    const result = parsePlugin('\uFEFF' + JSON.stringify({ id: 'minimal', name: 'Minimal', version: '1.0.0', presets: [{ id: 'flat', name: 'Flat', gains: Array(10).fill(0) }] }));
    expect(result.enabled).toBe(true);
    expect(result.presets[0]).toMatchObject({ preamp: 0, enhance: false, warmth: 0, clarity: 0, compression: 0, normalize: false });
  });

  it.each(['../outside', 'C:\\temp\\test', '/root', 'a/b', 'plugin:other:x', 'Name', '', 'a'.repeat(65)])('rejects unsafe plugin identifiers: %s', (id) => {
    expect(() => parsePlugin(pluginWith({ id }))).toThrow(/ID/);
  });

  it('accepts website JavaScript but rejects unknown manifest fields and prototype keys', () => {
    expect(parsePlugin(pluginWith({ script: 'api.toast("Hallo");' })).script).toBe('api.toast("Hallo");');
    expect(() => parsePlugin(pluginWith({ script: 'const =' }))).toThrow(/JavaScript/);
    expect(() => parsePlugin(pluginWith({ script: '} alert(1); function extra() {' }))).toThrow(/JavaScript/);
    expect(() => parsePlugin(pluginWith({ path: '../../data' }))).toThrow(/Unbekannter Schlüssel/);
    expect(() => parsePlugin('{"id":"evil","__proto__":{"polluted":true}}')).toThrow(/Schlüssel/);
    expect(() => parsePlugin('{"themes":[{"constructor":{"prototype":{}}}]}')).toThrow(/Schlüssel/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects malformed, oversized and unsupported documents', () => {
    for (const text of ['{', 'null', '[]', 'true']) expect(() => parsePlugin(text)).toThrow(/Ungültige Erweiterung/);
    expect(() => parsePlugin(' '.repeat(256 * 1024 + 1))).toThrow(/256 KiB/);
    expect(() => parsePlugin(pluginWith({ description: 'é'.repeat(140_000) }))).toThrow(/256 KiB/);
    expect(() => parsePlugin(pluginWith({ schemaVersion: 2 }))).toThrow(/schemaVersion/);
    expect(() => parsePlugin(pluginWith({ version: 'latest' }))).toThrow(/Version/);
    expect(() => parsePlugin(pluginWith({ name: '  ' }))).toThrow(/leer/);
    expect(() => parsePlugin(pluginWith({ enabled: 'false' }))).toThrow(/true oder false/);
    expect(() => parsePlugin(pluginWith({ presets: [], themes: [], sunoCss: '' }))).toThrow(/Plugin braucht/);
  });

  it('requires exactly ten finite EQ values and bounded audio settings', () => {
    const base = JSON.parse(pluginFile).presets[0];
    for (const gains of [[], Array(9).fill(0), Array(11).fill(0), [null, ...Array(9).fill(0)], ['2', ...Array(9).fill(0)], [12.1, ...Array(9).fill(0)], [-12.1, ...Array(9).fill(0)]]) {
      expect(() => parsePlugin(pluginWith({ presets: [{ ...base, gains }] }))).toThrow(/EQ/);
    }
    const infinity = pluginWith({ presets: [{ ...base, gains: [999, ...Array(9).fill(0)] }] }).replace('999', '1e999');
    expect(() => parsePlugin(infinity)).toThrow(/endliche Zahl/);
    for (const change of [{ preamp: -18.1 }, { preamp: 12.1 }, { warmth: -1 }, { clarity: 101 }, { compression: null }, { normalize: 1 }, { enhance: 'yes' }]) {
      expect(() => parsePlugin(pluginWith({ presets: [{ ...base, ...change }] }))).toThrow();
    }
    expect(parsePlugin(pluginWith({ presets: [{ ...base, preamp: -18, warmth: 100 }] })).presets[0].preamp).toBe(-18);
  });

  it('rejects duplicate contributions and excessively large lists', () => {
    const data = JSON.parse(pluginFile);
    expect(() => parsePlugin(pluginWith({ presets: [data.presets[0], data.presets[0]] }))).toThrow(/doppelt/);
    expect(() => parsePlugin(pluginWith({ themes: [data.themes[0], data.themes[0]] }))).toThrow(/doppelt/);
    expect(() => parsePlugin(pluginWith({ presets: Array(25).fill(data.presets[0]) }))).toThrow(/höchstens 24/);
    expect(() => parsePlugin(pluginWith({ themes: Array(13).fill(data.themes[0]) }))).toThrow(/höchstens 12/);
  });

  it.each(['red', '#12', '#1234', '#12345678', '#ggg', '#fff; background: red', 'var(--accent)', 'url(https://example.com)'])('rejects unsafe or unsupported theme colors: %s', (accent) => {
    const data = JSON.parse(themeFile);
    expect(() => parseTheme(JSON.stringify({ ...data, colors: { ...data.colors, accent } }))).toThrow(/Theme-Farbe/);
  });

  it('requires the complete color palette and normalizes valid hex values', () => {
    const data = JSON.parse(themeFile);
    delete data.colors.line;
    expect(() => parseTheme(JSON.stringify(data))).toThrow(/line/);
    data.colors.line = '#ABC';
    expect(parseTheme(JSON.stringify(data)).colors.line).toBe('#abc');
  });

  it.each([
    '@import "https://example.com/a.css";',
    'body { background: URL(//example.com/pixel); }',
    'body { background: u/**/rl(//example.com/pixel); }',
    'body { background: u\\72l(//example.com/pixel); }',
    'body { background: image-set("//example.com/a.png" 1x); }',
    'body { background: -webkit-image-set("//example.com/a.png" 1x); }',
    '@font-face { font-family: x; src: local(x); }',
    'body { width: expression(alert(1)); }',
    'body { behavior: test.htc; }',
    'body { -moz-binding: evil; }',
    '</style><script>alert(1)</script>',
  ])('rejects active or network CSS: %s', (sunoCss) => {
    expect(() => parsePlugin(pluginWith({ sunoCss }))).toThrow(/CSS/);
    expect(() => parseTheme(JSON.stringify({ ...JSON.parse(themeFile), sunoCss }))).toThrow(/CSS/);
  });

  it('accepts local styling, comments, media queries and CSS variables', () => {
    const sunoCss = '/* local styles */ @media (min-width: 800px) { main > button:hover { color: var(--customsuno-accent); border-radius: 8px; } }';
    expect(parsePlugin(pluginWith({ sunoCss })).sunoCss).toBe(sunoCss);
    expect(() => parsePlugin(pluginWith({ sunoCss: ' '.repeat(32 * 1024 + 1) }))).toThrow(/32768/);
  });
});

describe('extension activation and isolation', () => {
  it('namespaces contributions and excludes disabled or duplicate plugins', () => {
    const plugin = parsePlugin(pluginFile);
    const active = collectPresets([plugin, plugin]);
    expect(active).toHaveLength(BUILTIN_PRESETS.length + 2);
    expect(active.at(-1)?.id).toBe('plugin:studio-essentials:acoustic-detail');
    expect(collectPresets([{ ...plugin, enabled: false }])).toHaveLength(BUILTIN_PRESETS.length);
    expect(collectThemes([], [{ ...plugin, enabled: false }])).toHaveLength(BUILTIN_THEMES.length);
    expect(collectThemes([], [plugin]).at(-1)?.id).toBe('plugin:studio-essentials:copper');
  });

  it('protects built-in themes from custom ID collisions and returns independent objects', () => {
    const custom = parseTheme(themeFile);
    const themes = collectThemes([custom, custom, { ...custom, id: 'midnight' }], []);
    expect(themes).toHaveLength(BUILTIN_THEMES.length + 1);
    expect(themes[0].name).toBe('Suno Orange');
    themes[0].colors.accent = '#000';
    const presets = collectPresets([]);
    presets[0].gains[0] = 10;
    expect(BUILTIN_THEMES[0].colors.accent).toBe('#ff8b1a');
    expect(BUILTIN_PRESETS[0].gains[0]).toBe(0);
  });

  it('applies theme, enabled plugins and user CSS in an explicit order', () => {
    const plugin = parsePlugin(pluginFile);
    const result = buildSunoCss(parseTheme(themeFile), [plugin, { ...plugin, id: 'disabled', enabled: false, sunoCss: '.disabled { color: red; }' }], '.user-final { color: green; }');
    expect(result).toContain('--customsuno-accent: #60e5cf');
    expect(result).toContain('color-scheme: dark');
    expect(result.indexOf('caret-color')).toBeLessThan(result.indexOf('border-radius'));
    expect(result.trim().endsWith('.user-final { color: green; }')).toBe(true);
    expect(result).not.toContain('.disabled');
    expect(buildSunoCss(BUILTIN_THEMES[3], [], '')).toContain('color-scheme: light');
  });

  it('revalidates restored CSS and colors before webview injection', () => {
    expect(() => buildSunoCss(BUILTIN_THEMES[0], [], '@import "evil.css";')).toThrow(/CSS/);
    const malformed = { ...BUILTIN_THEMES[0], colors: { ...BUILTIN_THEMES[0].colors, accent: 'red; } body {' } };
    expect(() => buildSunoCss(malformed, [], '')).toThrow(/Theme-Farbe/);
    const plugin = parsePlugin(pluginFile);
    expect(() => buildSunoCss(BUILTIN_THEMES[0], [{ ...plugin, sunoCss: 'body { background: url(evil); }' }], '')).toThrow(/CSS/);
    const selected = collectThemes([], [plugin]).at(-1)!;
    expect(buildSunoCss(selected, [], '')).toContain('--customsuno-accent: #f2ab80');
  });
});
