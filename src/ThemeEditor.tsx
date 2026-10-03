import SunoButton from './SunoButton';
import { translator, type Language } from './i18n';
import { sunoThemeTokens } from './site-theme';
import { useEffect, useState } from 'react';
import { RotateCcw, Save, Plus } from 'lucide-react';
import type { Theme } from './extensions';
import { defaultBackground, importBackgroundImage, wallpaper, type ThemeBackground } from './theme-background';

const fields: [keyof Theme['colors'], string][] = [
  ['background', 'Hintergrund'],
  ['surface', 'Karten & Seitenleisten'],
  ['panel', 'Eingabefelder'],
  ['accent', 'Akzent'],
  ['text', 'Text'],
  ['muted', 'Sekundärer Text'],
  ['line', 'Rahmen'],
];
const pickerColor = (hex: string) => hex.length === 4 ? '#' + hex.slice(1).split('').map(c => c + c).join('') : hex;

export default function ThemeEditor({ theme, editable, onPreview, onSave, language }: {
  language: Language;
  theme: Theme;
  editable: boolean;
  onPreview: (theme: Theme | null) => void;
  onSave: (theme: Theme, copy: boolean) => void;
}) {
  const t = translator(language);
  const [draft, setDraft] = useState(theme);
  const [name, setName] = useState(editable ? theme.name : t('Mein Theme'));
  const [preview, setPreview] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const background = draft.background ?? { ...defaultBackground, color1: theme.colors.background, color2: theme.colors.accent };
  useEffect(() => {
    setDraft(theme); setName(editable ? theme.name : t('Mein Theme')); setPreview(false);
    setImageError(''); onPreview(null);
  }, [theme, editable, onPreview]);
  const update = (key: keyof Theme['colors'], value: string) => {
    const next = { ...draft, colors: { ...draft.colors, [key]: value } };
    setDraft(next); if (preview) onPreview(next);
  };
  const updateBackground = (partial: Partial<ThemeBackground>) => {
    const next = { ...draft, background: { ...background, ...partial } };
    setDraft(next); if (preview) onPreview(next);
  };
  const reset = () => { setDraft(theme); setName(editable ? theme.name : t('Mein Theme')); setPreview(false); onPreview(null); };
  return <details className="section theme-editor" onToggle={event => { if (!event.currentTarget.open) { setPreview(false); onPreview(null); } }}>
    <summary>{t("Theme bearbeiten")}</summary>
    <label>{t("Name")}<input value={name} maxLength={60} onChange={event => setName(event.target.value)} /></label>
    {fields.map(([key, label]) => <label className="theme-color-row" key={key}>
      <span><strong>{t(label)}</strong></span>
      <input type="color" aria-label={t(label)} value={pickerColor(draft.colors[key])} onChange={event => update(key, event.target.value)} />
    </label>)}
    <h3>{t("Hintergrund")}</h3>
    <label>{t("Hintergrundart")}<select value={background.type} onChange={event => updateBackground({ type: event.target.value as ThemeBackground['type'] })}>
      <option value="solid">{t("Einfarbig")}</option><option value="gradient">{t("Farbverlauf")}</option><option value="image">{t("Eigenes Bild")}</option>
    </select></label>
    {background.type === 'gradient' && <>
      <label className="theme-color-row"><span>{t("Verlauf: erste Farbe")}</span><input type="color" aria-label={t("Verlauf: erste Farbe")} value={pickerColor(background.color1)} onChange={event => updateBackground({ color1: event.target.value })} /></label>
      <label className="theme-color-row"><span>{t("Verlauf: zweite Farbe")}</span><input type="color" aria-label={t("Verlauf: zweite Farbe")} value={pickerColor(background.color2)} onChange={event => updateBackground({ color2: event.target.value })} /></label>
      <label className="range-label"><span>{t("Richtung")} <output>{background.angle}°</output></span><input aria-label={t("Verlaufsrichtung")} type="range" min={0} max={360} value={background.angle} onChange={event => updateBackground({ angle: Number(event.target.value) })} /></label>
    </>}
    {background.type === 'image' && <>
      <label className="image-picker">{t("Bild auswählen")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setImageBusy(true); setImageError('');
        try { updateBackground({ image: await importBackgroundImage(file) }); }
        catch (error) { setImageError(error instanceof Error ? error.message : 'Bild konnte nicht geladen werden.'); }
        finally { setImageBusy(false); }
      }} /></label>
      {imageBusy && <small role="status">{t("Bild wird geladen …")}</small>}
      {imageError && <p role="alert">{t(imageError)}</p>}
      <label>{t("Bilddarstellung")}<select value={background.fit} onChange={event => updateBackground({ fit: event.target.value as ThemeBackground['fit'] })}><option value="cover">{t("Ausfüllen")}</option><option value="contain">{t("Vollständig anzeigen")}</option><option value="repeat">{t("Kacheln")}</option></select></label>
      {background.image && <SunoButton className="text-btn" onClick={() => updateBackground({ image: '' })}>{t("Bild entfernen")}</SunoButton>}
    </>}
    {background.type !== 'solid' && <>
      <label className="range-label"><span>{t("Abdunklung")} <output>{background.dim} %</output></span><input aria-label={t("Abdunklung")} type="range" min={0} max={100} value={background.dim} onChange={event => updateBackground({ dim: Number(event.target.value) })} /></label>
      <label className="range-label"><span>{t("Deckkraft der Karten")} <output>{background.opacity} %</output></span><input aria-label={t("Deckkraft der Karten")} type="range" min={0} max={100} value={background.opacity} onChange={event => updateBackground({ opacity: Number(event.target.value) })} /></label>
    </>}
    <div className="theme-background-preview" aria-label={t("Hintergrund-Vorschau")} style={{ backgroundColor: draft.colors.background, backgroundImage: wallpaper(background), backgroundSize: background.fit === 'repeat' ? 'auto' : background.fit, backgroundRepeat: background.fit === 'repeat' ? 'repeat' : 'no-repeat', color: draft.colors.text }}><strong>{t("Vorschau")}</strong><span style={{ background: draft.colors.accent, color: sunoThemeTokens(draft.colors)['--customsuno-on-accent'] }}>{t("Akzent")}</span></div>
    <label className="theme-preview-toggle"><input type="checkbox" checked={preview} onChange={event => { setPreview(event.target.checked); onPreview(event.target.checked ? draft : null); }} />{t("Live-Vorschau")}</label>
    <div className="button-row">
      <SunoButton className="btn primary" disabled={imageBusy} onClick={() => onSave({ ...draft, name: name.trim() || t('Mein Theme') }, !editable)}><Save size={15} />{editable ? t("Änderungen speichern") : t("Theme speichern")}</SunoButton>
      {editable && <SunoButton className="btn" disabled={imageBusy} onClick={() => onSave({ ...draft, name: name.trim() || t('Mein Theme') }, true)}><Plus size={15} />{t("Als Kopie speichern")}</SunoButton>}
      <SunoButton className="btn" onClick={reset}><RotateCcw size={15} />{t("Zurücksetzen")}</SunoButton>
    </div>
  </details>;
}
