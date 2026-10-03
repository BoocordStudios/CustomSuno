import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, buildSunoCss, parseTheme } from './extensions';
import { defaultBackground, parseBackground } from './theme-background';
import { initialState, parseState } from './state';

describe('portable visual backgrounds', () => {
  it('round-trips a gradient through themes and saved state', () => {
    const theme = { ...BUILTIN_THEMES[0], id: 'custom-gradient', background: { ...defaultBackground, type: 'gradient' as const, angle: 270, color1: '#123456', color2: '#654321' } };
    expect(parseTheme(JSON.stringify(theme))).toEqual(theme);
    const state = parseState({ ...initialState(), themes: [theme], themeId: theme.id, siteThemeEnabled: true });
    expect(state.themes[0]).toEqual(theme);
    expect(buildSunoCss(state.themes[0], [], '')).toContain('linear-gradient(270deg, #123456, #654321)');
  });
  it('keeps local image data in exported themes without allowing arbitrary CSS URLs', () => {
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const theme = { ...BUILTIN_THEMES[0], background: { ...defaultBackground, type: 'image' as const, image, fit: 'contain' as const } };
    const restored = parseTheme(JSON.stringify(theme));
    expect(buildSunoCss(restored, [], '')).toContain(`url("${image}")`);
    expect(buildSunoCss(restored, [], '')).toContain('background-size: contain !important');
    expect(() => parseTheme(JSON.stringify({ ...theme, sunoCss: 'body { background: url(https://example.com); }' }))).toThrow();
  });
  it.each(['https://example.com/bg.jpg', 'file:///secret.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,abc");}body{color:red}'])('rejects unsupported image sources: %s', image => {
    expect(() => parseBackground({ ...defaultBackground, image })).toThrow();
  });
  it('rejects oversized image data and invalid controls', () => {
    expect(() => parseBackground({ ...defaultBackground, image: 'data:image/png;base64,' + 'a'.repeat(192 * 1024) })).toThrow();
    expect(() => parseBackground({ ...defaultBackground, angle: 999 })).toThrow();
    expect(() => parseBackground({ ...defaultBackground, opacity: -1 })).toThrow();
  });
});
