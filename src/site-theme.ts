import type { Theme } from './extensions';

/** Adapter for Suno's semantic tokens, including nested data-theme scopes and HXC controls. */
export function sunoThemeTokens(colors: Theme['colors']): Record<string, string> {
  const { background, surface, panel, accent, text, muted, line } = colors;
  const tokens: Record<string, string> = {};
  const set = (name: string, value: string) => { tokens[`--color-${name}`] = value; };
  const mix = (a: string, b: string, percent: number) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;
  const rgb = accent.slice(1).length === 3 ? accent.slice(1).split('').map(c => parseInt(c + c, 16)) : [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16));
  const luminance = rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  const onAccent = luminance > .179 ? '#101210' : '#ffffff';
  set('background-base', background);
  for (const [role, value] of Object.entries({ primary: background, secondary: surface, tertiary: panel })) {
    for (const suffix of ['', '-dark', '-light']) set(`background-${role}${suffix}`, value);
    set(`background-${role}-glass`, mix(value, 'transparent', 92));
  }
  for (const [role, value] of Object.entries({ primary: text, secondary: muted, tertiary: muted, inactive: mix(muted, background, 65) })) {
    for (const suffix of ['', '-on-dark', '-on-light', '-glass', '-translucent']) set(`foreground-${role}${suffix}`, value);
  }
  for (const role of ['primary', 'secondary']) for (const suffix of ['', '-glass', '-on-dark', '-on-light']) set(`border-${role}${suffix}`, line);
  for (const suffix of ['', '-on-dark', '-on-light']) set(`border-focus${suffix}`, accent);
  for (const role of ['primary', 'brand']) {
    set(`accent-${role}`, accent); set(`accent-${role}-on-primary`, accent); set(`accent-${role}-contrast`, onAccent);
  }
  for (const [role, value] of Object.entries({ primary: accent, secondary: panel, tertiary: 'transparent', inactive: panel })) {
    set(`background-button-${role}`, value);
    set(`foreground-button-${role}`, role === 'primary' ? onAccent : role === 'inactive' ? muted : text);
  }
  for (const role of ['fog', 'glass', 'smoke']) for (const [level, opacity] of Object.entries({ thin: 4, thick: 10, dense: 20 })) set(`background-${role}-${level}`, mix(text, 'transparent', opacity));
  set('overlay-on-primary', mix(text, 'transparent', 7));
  set('overlay-on-primary-inverse', mix(onAccent, 'transparent', 10));
  set('background-gradient-start', background); set('background-gradient-end', mix(background, 'transparent', 0));
  // Suno's dumbo scale runs from dark (50) to light (950). It is also referenced by gray utilities.
  const levels: Record<number, string> = { 50: background, 100: surface, 150: panel, 200: mix(panel, line, 75), 250: line, 300: line, 350: mix(line, muted, 70), 400: mix(line, muted, 40), 450: muted, 500: muted, 550: muted, 600: muted, 650: mix(muted, text, 70), 700: mix(muted, text, 50), 750: mix(muted, text, 30), 800: text, 850: text, 900: text, 950: text };
  for (const [level, value] of Object.entries(levels)) set(`dumbo-${level}`, value);
  tokens['--customsuno-on-accent'] = onAccent;
  return tokens;
}

export function themeIsLight(color: string): boolean {
  const hex = color.slice(1);
  const rgb = hex.length === 3 ? hex.split('').map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 160;
}
