import english from './locales/en.json';

export type Language = 'de' | 'en';
type Parameters = Record<string, string | number>;
const dictionary: Readonly<Record<string, string>> = english;

export function systemLanguage(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): Language {
  const primary = languages[0] ?? (typeof navigator === 'undefined' ? '' : navigator.language);
  return /^de(?:-|$)/i.test(primary) ? 'de' : 'en';
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Core and native errors retain their original text; localize them at the UI boundary.
const templates = Object.entries(dictionary).filter(([key]) => key.includes('{')).map(([key, value]) => {
  const names: string[] = [];
  let pattern = '', last = 0;
  for (const match of key.matchAll(/\{(\w+)\}/g)) {
    pattern += escapeRegex(key.slice(last, match.index)) + '([\\s\\S]+?)';
    names.push(match[1]); last = match.index! + match[0].length;
  }
  pattern += escapeRegex(key.slice(last));
  return { pattern: new RegExp(`^${pattern}$`), names, value, specificity: key.replace(/\{\w+\}/g, '').length };
}).sort((a, b) => b.specificity - a.specificity);

function localize(language: Language, text: string, depth = 0): string {
  if (language === 'de' || !text || depth > 5) return text;
  if (Object.hasOwn(dictionary, text)) return dictionary[text];
  for (const template of templates) {
    const match = template.pattern.exec(text);
    if (!match) continue;
    const values = Object.fromEntries(template.names.map((name, index) => [name,
      name === 'label' || name === 'error' ? localize(language, match[index + 1], depth + 1) : match[index + 1],
    ]));
    return template.value.replace(/\{(\w+)\}/g, (_, key: string) => values[key]);
  }
  return text;
}

export function translator(language: Language) {
  return (text: string, values?: Parameters): string => {
    const translated = localize(language, text);
    return values ? translated.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match) : translated;
  };
}
