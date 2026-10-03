import { describe, expect, it } from 'vitest';
import { systemLanguage, translator } from './i18n';
import english from './locales/en.json';
import { initialState, parseState } from './state';

describe('language selection', () => {
  it('uses the primary system language, including regional variants', () => {
    expect(systemLanguage(['de-DE', 'en-US'])).toBe('de');
    expect(systemLanguage(['de-AT'])).toBe('de');
    expect(systemLanguage(['DE-ch'])).toBe('de');
    expect(systemLanguage(['en-GB', 'de-DE'])).toBe('en');
    expect(systemLanguage(['fr-FR'])).toBe('en');
  });

  it('persists either language without changing plugin, theme or track content', () => {
    for (const language of ['de', 'en'] as const) {
      const state = { ...initialState(), language, library: [{ name: 'Mein Titel.wav', path: 'C:/Music/Mein Titel.wav', size: 42 }] };
      expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }
  });

  it('migrates existing backups and ignores invalid language values', () => {
    const defaultLanguage = initialState().language;
    for (const language of [undefined, null, 'fr', 'en-US', {}, 1]) {
      expect(parseState({ schemaVersion: 1, language }).language).toBe(defaultLanguage);
    }
  });
});

describe('localized UI messages', () => {
  it('switches labels and interpolates data without translating user content', () => {
    const de = translator('de'), en = translator('en');
    expect(de('Mediathek')).toBe('Mediathek');
    expect(en('Mediathek')).toBe('Library');
    expect(en('{name} entfernen', { name: 'Mein Plugin $& {name}' })).toBe('Remove Mein Plugin $& {name}');
    expect(de('{name} entfernen', { name: 'My plugin' })).toBe('My plugin entfernen');
    expect(en('{format} exportieren', { format: 'MP3' })).toBe('Export MP3');
  });

  it('localizes nested validation errors, progress and native messages', () => {
    const en = translator('en');
    expect(en('Einstellungen: Ungültige Erweiterung: Theme-Farbe „accent“ muss #RGB oder #RRGGBB sein.'))
      .toBe('Settings: Invalid extension: Theme color “accent” must be #RGB or #RRGGBB.');
    expect(en('Ungültige Erweiterung: Wärme muss eine endliche Zahl zwischen 0 und 100 sein.'))
      .toBe('Invalid extension: Warmth must be a finite number between 0 and 100.');
    expect(en('MP3 wird kodiert … 42 %')).toBe('Encoding MP3 … 42 %');
    expect(en('WAV kodieren … 75 %')).toBe('Encoding WAV … 75 %');
    expect(en('Download abgeschlossen: Mein Titel (1).wav')).toBe('Download complete: Mein Titel (1).wav');
    expect(en('Eine Datei mit diesem Namen existiert bereits.')).toBe('A file with this name already exists.');
  });

  it('preserves technical errors that do not belong to the app', () => {
    const message = 'NotAllowedError: Access denied (C:/My files/track.wav)';
    expect(translator('en')(message)).toBe(message);
    expect(translator('de')(message)).toBe(message);
  });

  it('keeps interpolation parameters intact in every translation', () => {
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [german, translated] of Object.entries(english)) {
      expect(translated.trim(), german).not.toBe('');
      expect(parameters(translated), german).toEqual(parameters(german));
    }
  });
});
