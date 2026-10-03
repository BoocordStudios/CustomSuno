import { describe, expect, it } from 'vitest';
import pluginExample from '../examples/studio-essentials.plugin.json';
import themeExample from '../examples/ocean.theme.json';
import { DEFAULT_AUDIO_SETTINGS } from './audio';
import { BUILTIN_THEMES, buildSunoCss, collectPresets, collectThemes, parsePlugin, parseTheme } from './extensions';
import { initialState, parseState, type AppState } from './state';

function renderCss(state: AppState): string {
  const selected = collectThemes(state.themes, state.plugins).find(theme => theme.id === state.themeId) ?? BUILTIN_THEMES[0];
  return buildSunoCss(selected, state.plugins, state.sunoCss);
}

describe('settings and backup restoration', () => {
  it('creates independent defaults for a first launch', () => {
    expect(parseState(null)).toEqual(initialState());
    expect(parseState(undefined)).toEqual(initialState());
    const first = initialState();
    const second = initialState();
    first.audio.gains[0] = 8;
    expect(second.audio.gains[0]).toBe(0);
    expect(DEFAULT_AUDIO_SETTINGS.gains[0]).toBe(0);
    expect(renderCss(second)).toContain('--customsuno-accent: #ff8b1a');
  });

  it('roundtrips the actual saved schema with plugins, themes, audio and library', () => {
    const plugin = parsePlugin(JSON.stringify(pluginExample));
    const ocean = parseTheme(JSON.stringify(themeExample));
    const disabled = { ...plugin, id: 'inactive-studio', enabled: false };
    const preset = collectPresets([plugin]).find(preset => preset.id === 'plugin:studio-essentials:night-listening')!;
    const state: AppState = {
      ...initialState(),
      schemaVersion: 1,
      themeId: 'plugin:studio-essentials:copper',
      themes: [ocean, { ...ocean, id: 'custom-798f0cd6-7606-4596-9cec-eb0582f7ac4e', name: 'Mein Theme' }],
      plugins: [plugin, disabled],
      audio: { gains: [...preset.gains], preamp: preset.preamp, enhance: preset.enhance, warmth: preset.warmth, clarity: preset.clarity, compression: preset.compression, normalize: preset.normalize },
      library: [{ name: 'Mein Track.wav', path: 'C:\\Users\\Name\\Music\\Mein Track.wav', size: 123_456 }],
      sunoCss: 'button:focus-visible { outline: 2px solid var(--customsuno-accent); }',
      volume: 0.36,
    };
    const restored = parseState(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual(state);
    expect(restored.plugins[1].enabled).toBe(false);
    expect(restored.plugins[0].themes[0].id).toBe('copper');
    expect(collectThemes(restored.themes, restored.plugins).filter(theme => theme.id.startsWith('plugin:'))).toHaveLength(1);
    expect(renderCss(restored)).toContain('--customsuno-accent: #f2ab80');
    expect(renderCss(restored)).toContain('button:focus-visible');
    restored.plugins[0].presets[0].gains[0] = 10;
    restored.themes[0].colors.accent = '#fff';
    restored.library[0].name = 'Changed.wav';
    expect(state.plugins[0].presets[0].gains[0]).toBe(1);
    expect(state.themes[0].colors.accent).toBe('#60e5cf');
    expect(state.library[0].name).toBe('Mein Track.wav');
  });

  it('preserves the selected plugin theme while its plugin is disabled and uses a renderable fallback', () => {
    const plugin = { ...parsePlugin(JSON.stringify(pluginExample)), enabled: false };
    const state = parseState({ ...initialState(), plugins: [plugin], themeId: 'plugin:studio-essentials:copper' });
    expect(state.themeId).toBe('plugin:studio-essentials:copper');
    expect(renderCss(state)).toContain('--customsuno-accent: #ff8b1a');
    state.plugins[0].enabled = true;
    expect(renderCss(state)).toContain('--customsuno-accent: #f2ab80');
  });

  it.each([
    '@import "remote.css";',
    'body { background: url(https://example.com/pixel); }',
    '</style><script>alert(1)</script>',
    'a'.repeat(32 * 1024 + 1),
    123,
    null,
  ])('rejects unsafe user CSS before a restored state can reach React: %s', (sunoCss) => {
    expect(() => parseState({ ...initialState(), sunoCss })).toThrow();
  });

  it('validates plugin and theme CSS even when their contributions are inactive', () => {
    const plugin = { ...pluginExample, enabled: false, sunoCss: '@import "remote.css";' };
    expect(() => parseState({ ...initialState(), plugins: [plugin] })).toThrow(/CSS/);
    const invalidTheme = { ...themeExample, sunoCss: 'body { behavior: remote.htc; }' };
    expect(() => parseState({ ...initialState(), themes: [invalidTheme] })).toThrow(/CSS/);
    const nested = { ...pluginExample, themes: [{ ...themeExample, colors: { ...themeExample.colors, accent: '#fff; background:red' } }] };
    expect(() => parseState({ ...initialState(), plugins: [nested] })).toThrow(/Theme-Farbe/);
  });

  it('rejects duplicate extension IDs instead of creating conflicting UI entries', () => {
    expect(() => parseState({ ...initialState(), plugins: [pluginExample, pluginExample] })).toThrow(/doppelt/);
    expect(() => parseState({ ...initialState(), themes: [themeExample, themeExample] })).toThrow(/doppelt/);
  });

  it('rejects malformed roots, unknown versions and malformed extension lists', () => {
    for (const input of [false, 'text', 123, [], { schemaVersion: 2 }, { schemaVersion: '1' }, {}]) expect(() => parseState(input)).toThrow();
    for (const input of [{ plugins: {} }, { themes: null }, { plugins: [null] }, { themes: [null] }]) {
      expect(() => parseState({ ...initialState(), ...input })).toThrow();
    }
  });

  it('handles partial v1 documents and ignores invalid theme selections', () => {
    expect(parseState({ schemaVersion: 1 })).toEqual(initialState());
    expect(parseState({ schemaVersion: 1, audio: {} }).audio).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseState({ schemaVersion: 1, audio: [] }).audio).toEqual(DEFAULT_AUDIO_SETTINGS);
    for (const themeId of ['../outside', '', 'plugin:a:b:extra', 1, null]) {
      expect(parseState({ schemaVersion: 1, themeId }).themeId).toBe('midnight');
    }
    const missing = parseState({ schemaVersion: 1, themeId: 'removed-theme' });
    expect(missing.themeId).toBe('removed-theme');
    expect(() => renderCss(missing)).not.toThrow();
  });

  it('normalizes audio from malformed backups into ten finite, bounded bands', () => {
    const state = parseState({
      schemaVersion: 1,
      audio: { gains: [99, -99, null, '4', Number.POSITIVE_INFINITY, Number.NaN, 3.5], preamp: -100, warmth: 200, clarity: -100, compression: Number.NaN, enhance: 'true', normalize: 'false' },
      volume: 4,
    });
    expect(state.audio.gains).toEqual([12, -12, 0, 0, 0, 0, 3.5, 0, 0, 0]);
    expect(state.audio).toMatchObject({ preamp: -18, warmth: 100, clarity: 0, compression: 25, enhance: false, normalize: false });
    expect(state.volume).toBe(1);
    expect(parseState({ schemaVersion: 1, volume: -1 }).volume).toBe(0);
    expect(parseState({ schemaVersion: 1, volume: Number.NaN }).volume).toBe(0.75);
    const sparse = parseState({ schemaVersion: 1, audio: { gains: Array(10) } });
    expect(sparse.audio.gains).toEqual(Array(10).fill(0));
    expect(sparse.audio.gains.map(value => value.toFixed(0))).toHaveLength(10);
  });

  it('copies only usable library metadata and removes duplicate paths', () => {
    const file = { name: 'Track.wav', path: 'C:\\Music\\Track.wav', size: 42, extra: { executable: true } };
    const state = parseState({ schemaVersion: 1, library: [
      file, file, null, [], 'text',
      { ...file, name: '' }, { ...file, name: '   ' }, { ...file, name: 'bad\u0000name' },
      { ...file, path: '' }, { ...file, path: 'bad\npath' },
      { ...file, path: 'x', size: -1 }, { ...file, path: 'y', size: Number.POSITIVE_INFINITY },
      { ...file, path: 'z', size: 1.2 },
      { name: 'Session.mp3', path: 'browser:track-1', size: 200 },
    ] });
    expect(state.library).toEqual([
      { name: 'Track.wav', path: 'C:\\Music\\Track.wav', size: 42 },
      { name: 'Session.mp3', path: 'browser:track-1', size: 200 },
    ]);
    expect(state.library[0]).not.toBe(file);
    const large = Array.from({ length: 1005 }, (_, index) => ({ name: `${index}.wav`, path: `C:\\Music\\${index}.wav`, size: index }));
    expect(parseState({ schemaVersion: 1, library: large }).library).toHaveLength(1000);
  });
});
