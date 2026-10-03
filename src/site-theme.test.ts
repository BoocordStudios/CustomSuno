import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, buildSunoCss } from './extensions';
import { sunoThemeTokens } from './site-theme';

describe('Suno semantic theme adapter', () => {
  it.each(BUILTIN_THEMES)('maps $id to nested Suno surfaces and HXC buttons', theme => {
    const tokens = sunoThemeTokens(theme.colors);
    expect(tokens['--color-background-primary']).toBe(theme.colors.background);
    expect(tokens['--color-background-secondary-dark']).toBe(theme.colors.surface);
    expect(tokens['--color-background-tertiary-light']).toBe(theme.colors.panel);
    expect(tokens['--color-foreground-primary-on-light']).toBe(theme.colors.text);
    expect(tokens['--color-border-primary']).toBe(theme.colors.line);
    expect(tokens['--color-background-button-primary']).toBe(theme.colors.accent);
    expect(buildSunoCss(theme, [], '')).toContain(':root, [data-theme]');
  });
  it('keeps button text readable for bright and dark custom accents', () => {
    for (const accent of ['#fff', '#ffffff', '#c2f970']) {
      expect(sunoThemeTokens({ ...BUILTIN_THEMES[0].colors, accent })['--color-foreground-button-primary']).toBe('#101210');
    }
    for (const accent of ['#000', '#000000', '#38751b']) {
      expect(sunoThemeTokens({ ...BUILTIN_THEMES[0].colors, accent })['--color-foreground-button-primary']).toBe('#ffffff');
    }
  });
  it('places user CSS after the semantic adapter', () => {
    const override = ':root, [data-theme] { --color-background-primary: pink !important; }';
    expect(buildSunoCss(BUILTIN_THEMES[0], [], override).endsWith(override)).toBe(true);
  });
});
