import { version } from '../package.json';
import { translator } from './i18n';
import ExportFormatSelect from './ExportFormatSelect';
import { encodeExport, type ExportFormat } from './audio-export';
import { useDrawerMotion } from './useDrawerMotion';
import MediaLibrary from './MediaLibrary';
import { tagWav, type TrackMetadata } from './media';
import SunoButton from './SunoButton';
import { wallpaper, surfaceColor } from './theme-background';
import ThemeEditor from './ThemeEditor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowLeft, ArrowRight, Check, Code2, Download, ExternalLink, FolderOpen, Home, LoaderCircle, LockKeyhole, Palette, Pause, Play, Plus, Puzzle, RotateCcw, Save, Settings2, SlidersHorizontal, Trash2, Upload, Volume2, WandSparkles, X } from 'lucide-react';
import * as bridge from './bridge';
import { AudioEngine, DEFAULT_AUDIO_SETTINGS, FREQUENCIES, type AudioSettings } from './audio';
import { BUILTIN_THEMES, buildSunoCss, collectPresets, collectThemes, parsePlugin, parseTheme, type CustomPlugin, type Theme } from './extensions';
import { initialState, parseState, type AppState } from './state';
import { sunoThemeTokens, themeIsLight } from './site-theme';

type BrowserTab = { id: string; title: string; url: string; loading: boolean };
type BrowserStatus = { tabs: BrowserTab[]; active: string };

type Panel = 'mods' | 'plugins' | 'themes' | 'downloads' | 'audio' | 'settings';
const sections = [
  { id: 'mods' as Panel, title: 'Mods', icon: WandSparkles },
  { id: 'plugins' as Panel, title: 'Plugins', icon: Puzzle },
  { id: 'themes' as Panel, title: 'Themes', icon: Palette },
  { id: 'downloads' as Panel, title: 'Mediathek', icon: Download },
  { id: 'audio' as Panel, title: 'Audio', icon: SlidersHorizontal },
  { id: 'settings' as Panel, title: 'Einstellungen', icon: Settings2 },
];
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);
const time = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
const isAudio = (name: string) => /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|webm)$/i.test(name);
let saveQueue = Promise.resolve();
const persist = (state: AppState) => {
  const stored = { ...state, library: state.library.filter(f => !f.path.startsWith('browser:')) };
  saveQueue = saveQueue.catch(() => {}).then(() => bridge.saveState(stored));
  return saveQueue;
};
function Switch({ value, change, label }: { value: boolean; change: (value: boolean) => void; label: string }) {
  return <button className={`switch ${value ? 'checked' : ''}`} role="switch" aria-label={label} aria-checked={value} onClick={() => change(!value)}><span /></button>;
}

export default function BrowserApp() {
  const [state, setState] = useState<AppState>(initialState);
  const t = translator(state.language);
  useEffect(() => { document.documentElement.lang = state.language; }, [state.language]);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [browser, setBrowser] = useState<BrowserStatus>({ tabs: [{ id: 'suno', title: 'Suno', url: 'https://suno.com', loading: false }], active: 'suno' });
  const [tabBusy, setTabBusy] = useState(false);
  const tabOperation = useRef(false);
  const tabRevision = useRef(0);
  const activeTab = browser.tabs.find(tab => tab.id === browser.active);
  const address = activeTab?.url || 'https://suno.com';
  const siteLoading = activeTab?.loading ?? false;
  const [mediaEditing, setMediaEditing] = useState(false);
  const [downloads, setDownloads] = useState<bridge.AudioFile[]>([]);
  const [pendingDownloads, setPendingDownloads] = useState<string[]>([]);
  const [css, setCss] = useState('');
  const [pluginDraft, setPluginDraft] = useState<string | null>(null);
  const [themePreview, setThemePreview] = useState<Theme | null>(null);
  const [track, setTrack] = useState<{ name: string; duration: number; waveform: number[]; sampleRate: number; metadata?: TrackMetadata } | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [busy, setBusy] = useState('');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [bypass, setBypass] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inputKind = useRef<'plugin' | 'theme' | 'backup' | 'audio'>('plugin');
  const engine = useRef(new AudioEngine());
  const latest = useRef({ state, ready, bypass }); latest.current = { state, ready, bypass };
  const themes = useMemo(() => collectThemes(state.themes, state.plugins), [state.themes, state.plugins]);
  const presets = useMemo(() => collectPresets(state.plugins), [state.plugins]);
  const theme = themes.find(t => t.id === state.themeId) ?? BUILTIN_THEMES[0];
  const activeTheme = panel === 'themes' && themePreview?.id === theme.id ? themePreview : theme;
  const customThemeActive = state.siteThemeEnabled || (panel === 'themes' && themePreview?.id === theme.id);
  useEffect(() => {
    const root = document.documentElement;
    const tokens = sunoThemeTokens({ ...activeTheme.colors, surface: surfaceColor(activeTheme.colors.surface, activeTheme.background), panel: surfaceColor(activeTheme.colors.panel, activeTheme.background) });
    for (const [key, value] of Object.entries(tokens)) {
      if (customThemeActive) root.style.setProperty(key, value); else root.style.removeProperty(key);
    }
    root.style.setProperty('--wallpaper-panel', customThemeActive ? surfaceColor(activeTheme.colors.background, activeTheme.background) : 'var(--color-background-primary)');
    root.style.setProperty('--wallpaper', customThemeActive ? wallpaper(activeTheme.background) : 'none');
    root.style.setProperty('--wallpaper-size', activeTheme.background?.fit === 'repeat' ? 'auto' : activeTheme.background?.fit ?? 'cover');
    root.style.setProperty('--wallpaper-repeat', activeTheme.background?.fit === 'repeat' ? 'repeat' : 'no-repeat');
    root.style.colorScheme = customThemeActive && themeIsLight(activeTheme.colors.background) ? 'light' : 'dark';
  }, [activeTheme, customThemeActive]);
  const siteConfig = useMemo(() => ({
    css: customThemeActive ? buildSunoCss(activeTheme, state.plugins, state.sunoCss) : [...state.plugins.filter(p => p.enabled).map(p => p.sunoCss), state.sunoCss].filter(Boolean).join('\n'),
    mods: state.mods,
    plugins: state.plugins.filter(p => p.enabled && p.script).map(p => ({ id: p.id, name: p.name, script: p.script })),
  }), [customThemeActive, activeTheme, state.plugins, state.sunoCss, state.mods]);
  const notify = (text: string, error = false) => setNotice({ text, error });
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { notify(errorMessage(e), true); } };
  const call = async <T,>(command: string, args?: Record<string, unknown>): Promise<T | undefined> => { if (bridge.desktop) return invoke<T>(command, args); };
  const show = (next: Panel) => { if (mediaEditing) { notify('Bearbeitung speichern oder verwerfen. Laufenden Vorgang abwarten.'); return; } setPanel(old => old === next ? null : next); };
  const { displayedPanel, drawerRef, reduced } = useDrawerMotion(panel, state.mods.motion, error => notify(errorMessage(error), true));
  const audioUpdate = (partial: Partial<AudioSettings>) => setState(old => ({ ...old, audio: { ...old.audio, ...partial } }));
  const browse = (action: string) => void run(() => call('browser_action', { action }));
  const tabAction = (action: 'new' | 'select' | 'close', id?: string) => void run(async () => {
    if (tabOperation.current) return;
    tabOperation.current = true; tabRevision.current += 1; setTabBusy(true);
    try {
      if (bridge.desktop) {
        await call('browser_tab', { action, id });
        const status = await call<BrowserStatus>('browser_status');
        if (status) setBrowser(status);
      } else {
        setBrowser(old => {
          if (action === 'new') {
            const tab = { id: crypto.randomUUID(), title: 'Suno', url: 'https://suno.com', loading: false };
            return { tabs: [...old.tabs, tab], active: tab.id };
          }
          if (!old.tabs.some(tab => tab.id === id)) return old;
          if (action === 'select') return { ...old, active: id! };
          if (old.tabs.length === 1) return old;
          const index = old.tabs.findIndex(tab => tab.id === id);
          return { tabs: old.tabs.filter(tab => tab.id !== id), active: old.active === id ? old.tabs[index > 0 ? index - 1 : 1].id : old.active };
        });
      }
    } finally { tabOperation.current = false; setTabBusy(false); }
  });
  useEffect(() => { document.title = `${activeTab?.title || 'Suno'} - CustomSuno`; }, [activeTab?.title]);
  useEffect(() => { document.getElementById(`tab-${browser.active}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [browser.active]);
  const choose = (kind: typeof inputKind.current) => {
    if (kind === 'audio' && bridge.desktop) { void run(async () => { const file = await bridge.importAudio(undefined, state.language); if (file) await loadAudio(file); }); return; }
    inputKind.current = kind;
    if (input.current) { input.current.accept = kind === 'audio' ? 'audio/*' : kind === 'plugin' ? '.json,.js' : '.json'; input.current.click(); }
  };

  useEffect(() => {
    void bridge.loadState().then(data => { const loaded = parseState(data); setState(loaded); setCss(loaded.sunoCss); setReady(true); }).catch(e => { notify(`Einstellungen: ${errorMessage(e)}`, true); setPanel('settings'); });
    void bridge.listMedia().then(setDownloads).catch(e => notify(errorMessage(e), true));
  }, []);
  useEffect(() => { if (!ready) return; const timer = setTimeout(() => void persist(state).catch(e => notify(`Speichern: ${errorMessage(e)}`, true)), 200); return () => clearTimeout(timer); }, [state, ready]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void call('configure_site', { config: siteConfig }).catch(e => notify(errorMessage(e), true)), 80);
    return () => clearTimeout(timer);
  }, [siteConfig, ready]);
  useEffect(() => { if (ready) void call('browser_zoom', { zoom: state.zoom }).catch(e => notify(errorMessage(e), true)); }, [state.zoom, ready]);
  useEffect(() => {
    if (!bridge.desktop) return;
    const cleanups: (() => void)[] = []; let dead = false;
    const add = (promise: Promise<() => void>) => void promise.then(fn => { if (dead) fn(); else cleanups.push(fn); }).catch(e => notify(errorMessage(e), true));
    add(listen<{ name: string }>('download-started', e => { setPendingDownloads(old => [...old, e.payload.name]); notify(`Download gestartet: ${e.payload.name}`); }));
    add(bridge.onDownload(file => { setDownloads(old => [file, ...old.filter(f => f.path !== file.path)]); setPendingDownloads(old => old.filter(name => name !== file.name)); notify(`Download abgeschlossen: ${file.name}`); }));
    add(bridge.onDownloadError(message => { setPendingDownloads([]); notify(message, true); }));
    add(getCurrentWindow().onCloseRequested(async event => { event.preventDefault(); try { if (latest.current.ready) await persist(latest.current.state); await getCurrentWindow().destroy(); } catch (e) { notify(`Schließen: ${errorMessage(e)}`, true); } }));
    const refresh = async () => {
      if (tabOperation.current) return;
      const revision = tabRevision.current;
      try {
        const value = await call<BrowserStatus>('browser_status');
        if (!dead && !tabOperation.current && revision === tabRevision.current && value) setBrowser(value);
      } catch { /* Retry on the next poll while the native view starts. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    return () => { dead = true; cleanups.forEach(fn => fn()); clearInterval(timer); };
  }, []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), notice.error ? 12000 : 6000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => { engine.current.update(bypass ? { ...DEFAULT_AUDIO_SETTINGS, preamp: 0, enhance: false, gains: Array(10).fill(0) } : state.audio); }, [state.audio, bypass]);
  useEffect(() => { engine.current.setVolume(state.volume); }, [state.volume]);
  useEffect(() => { const timer = setInterval(() => { setPosition(engine.current.currentTime); setPlaying(engine.current.playing); }, 150); return () => { clearInterval(timer); engine.current.dispose(); }; }, []);

  async function loadAudio(file: bridge.AudioFile) {
    setBusy('Datei wird geladen …');
    try {
      const result = await engine.current.load(await bridge.readAudio(file));
      setTrack({ name: file.name, metadata: file.metadata, ...result }); setPosition(0); setPanel('audio');
      setState(old => ({ ...old, library: [file, ...old.library.filter(f => f.path !== file.path)] }));
    } finally { setBusy(''); }
  }
  async function exportAudio() {
    if (!track) return;
    setBusy('Audio wird gerendert …');
    try {
      engine.current.update(state.audio);
      const bytes = tagWav(await engine.current.exportWav(setBusy), track.metadata ?? { title: track.name, artist: '', cover: '', lyrics: '' });
      const encoded = await encodeExport(bytes, exportFormat, setBusy, track.metadata);
      const saved = await bridge.saveAudio(`${track.name.replace(/\.[^.]+$/, '')}-enhanced.${exportFormat}`, encoded, exportFormat, state.language);
      if (saved) notify(`Bearbeitete ${exportFormat.toUpperCase()}-Datei gespeichert.`);
    } finally {
      const value = latest.current;
      engine.current.update(value.bypass ? { ...DEFAULT_AUDIO_SETTINGS, preamp: 0, enhance: false, gains: Array(10).fill(0) } : value.state.audio);
      setBusy('');
    }
  }
  function installPlugin(plugin: CustomPlugin) {
    setState(old => ({ ...old, plugins: [...old.plugins.filter(p => p.id !== plugin.id), plugin] }));
    notify(`${plugin.name} ${plugin.enabled ? 'aktiviert' : 'importiert'}.`);
  }
  async function readFile(file: File) {
    const kind = inputKind.current;
    if (kind === 'audio') { const entry = await bridge.importAudio(file, state.language); if (entry) await loadAudio(entry); return; }
    if (file.size > 2 * 1024 * 1024) throw new Error('Datei zu groß. Maximal 2 MB.');
    const content = await file.text();
    if (kind === 'plugin') {
      if (file.name.endsWith('.js')) {
        const name = file.name.replace(/\.js$/, '');
        const id = `user-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 45)}`;
        installPlugin(parsePlugin(JSON.stringify({ id, name, version: '1.0.0', enabled: false, script: content })));
      } else installPlugin(parsePlugin(content));
    } else if (kind === 'theme') {
      const imported = parseTheme(content);
      if (BUILTIN_THEMES.some(t => t.id === imported.id)) imported.id = `custom-${imported.id}`;
      setState(old => ({ ...old, themeId: imported.id, siteThemeEnabled: true, themes: [...old.themes.filter(t => t.id !== imported.id), imported] }));
      notify('Theme importiert und auf Suno angewendet.');
    } else { const restored = parseState(JSON.parse(content)); setState(restored); setCss(restored.sunoCss); setReady(true); notify('Backup wiederhergestellt.'); }
  }
  const allAudio = [...downloads.filter(f => isAudio(f.name)), ...state.library.filter(f => !downloads.some(d => d.path === f.path))];

  return <div className="browser-shell" data-reduced-motion={reduced}>
    <input ref={input} type="file" className="hidden-input" aria-label={t("Datei importieren")} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(() => readFile(file)); }} />
    <header className="browser-toolbar">
      <div className="browser-brand"><img src="/logo.png" alt="CustomSuno" /><strong>CustomSuno</strong></div>
      <div className="navigation-buttons"><SunoButton title={t("Zurück")} aria-label={t("Zurück")} onClick={() => browse('back')}><ArrowLeft /></SunoButton><SunoButton title={t("Vorwärts")} aria-label={t("Vorwärts")} onClick={() => browse('forward')}><ArrowRight /></SunoButton><SunoButton title={t("Suno neu laden")} aria-label={t("Suno neu laden")} onClick={() => browse('reload')}>{siteLoading && bridge.desktop ? <LoaderCircle className="spin" /> : <RotateCcw />}</SunoButton><SunoButton title={t("Suno Startseite")} aria-label={t("Suno Startseite")} onClick={() => browse('home')}><Home /></SunoButton></div>
      <div className="address" title={address}><LockKeyhole size={12} /><span>{address.replace(/^https:\/\//, '')}</span></div>
      <nav className="mod-buttons" aria-label={t("CustomSuno Mod-Leiste")}>{sections.map(section => <SunoButton key={section.id} className={panel === section.id ? 'active' : ''} title={t(section.title)} aria-label={t(section.title)} aria-expanded={panel === section.id} onClick={() => show(section.id)}><section.icon /><span>{t(section.title)}</span>{section.id === 'downloads' && pendingDownloads.length > 0 && <i className="download-dot" />}</SunoButton>)}</nav>
    </header>
    <div className="browser-tabs">
      <div className="tab-list" role="tablist" aria-label={t("Suno-Tabs")}>{browser.tabs.map(tab => <div className={`browser-tab ${browser.active === tab.id ? 'selected' : ''}`} key={tab.id}>
        <button id={`tab-${tab.id}`} role="tab" aria-selected={browser.active === tab.id} title={tab.url} disabled={tabBusy} onClick={() => tabAction('select', tab.id)}>{tab.loading ? <LoaderCircle size={13} className="spin" /> : <img src="/logo.png" alt="" />}<span>{tab.title || 'Suno'}</span></button>
        <button className="tab-close" aria-label={t('{name} schließen', { name: tab.title || 'Suno' })} title={t("Tab schließen")} disabled={tabBusy || browser.tabs.length === 1} onClick={() => tabAction('close', tab.id)}><X size={13} /></button>
      </div>)}</div>
      <SunoButton className="new-tab" aria-label={t("Neuer Suno-Tab")} title={t("Neuer Suno-Tab")} disabled={tabBusy} onClick={() => tabAction('new')}><Plus size={16} /></SunoButton>
    </div>
    {!bridge.desktop && <div className="browser-preview"><img src="/logo.png" alt="" /><h1>CustomSuno</h1><p>{t("Browser-Vorschau · Suno läuft in der Desktop-App.")}</p><code>npm run desktop</code><SunoButton className="btn" onClick={() => void bridge.openBrowser()}>{t("suno.com im Browser öffnen")} <ExternalLink size={15} /></SunoButton></div>}
    {displayedPanel && <aside ref={drawerRef} className="tools-drawer" aria-hidden={!panel} aria-label={t('{label} Seitenleiste', { label: t(sections.find(s => s.id === displayedPanel)!.title) })}><div className="drawer-title"><div><h1>{t(sections.find(s => s.id === displayedPanel)!.title)}</h1></div><SunoButton className="icon-btn" title={t("Seitenleiste schließen")} aria-label={t("Seitenleiste schließen")} onClick={() => { if (mediaEditing) notify('Bearbeitung speichern oder verwerfen. Laufenden Vorgang abwarten.'); else setPanel(null); }}><X /></SunoButton></div><div className="drawer-content" key={displayedPanel}>
      {displayedPanel === 'mods' && <>{([
        ['compact', t("Kompakte Ansicht"), ''],
        ['focus', t("Fokus-Modus"), t("Navigation ausblenden")],
        ['motion', t("Weniger Animationen"), ''],
        ['shortcuts', t("Medien-Tastenkürzel"), t("Alt + Leertaste")],
      ] as const).map(([key, title, description]) => <div className="option-row" key={key}><div><strong>{title}</strong>{description && <p>{description}</p>}</div><Switch label={title} value={state.mods[key]} change={value => setState(old => ({ ...old, mods: { ...old.mods, [key]: value } }))} /></div>)}<div className="section"><h2>{t("Webseiten-Zoom")}</h2><div className="zoom-control"><SunoButton className="btn" disabled={state.zoom <= .5} onClick={() => setState(old => ({ ...old, zoom: Math.max(.5, Math.round((old.zoom - .1) * 10) / 10) }))}>−</SunoButton><output>{Math.round(state.zoom * 100)} %</output><SunoButton className="btn" disabled={state.zoom >= 2} onClick={() => setState(old => ({ ...old, zoom: Math.min(2, Math.round((old.zoom + .1) * 10) / 10) }))}>+</SunoButton><SunoButton className="icon-btn" aria-label={t("Zoom zurücksetzen")} onClick={() => setState(old => ({ ...old, zoom: 1 }))}><RotateCcw size={16} /></SunoButton></div></div></>}

      {displayedPanel === 'plugins' && <><div className="button-row"><SunoButton className="btn primary" onClick={() => choose('plugin')}><Plus size={15} />{t("Importieren")}</SunoButton><SunoButton className="btn" onClick={() => setPluginDraft(JSON.stringify({ id: 'mein-plugin', name: t('Mein Plugin'), version: '1.0.0', author: t('Ich'), enabled: true, script: 'api.toast("CustomSuno plugin active");\nreturn () => {};' }, null, 2))}><Code2 size={15} />{t("Erstellen")}</SunoButton></div>
        {state.plugins.map(plugin => <section className="plugin-card" key={plugin.id}><div className="card-heading"><div><h2>{plugin.name}</h2><small>v{plugin.version}{plugin.author && ` · ${plugin.author}`}</small></div><Switch label={t('{name} aktivieren', { name: plugin.name })} value={plugin.enabled} change={enabled => setState(old => ({ ...old, plugins: old.plugins.map(p => p.id === plugin.id ? { ...p, enabled } : p) }))} /></div><details className="plugin-details"><summary>{t("Details")}</summary>{plugin.description && <p>{plugin.description}</p>}<div className="tags">{plugin.script && <span>{t("JavaScript · Webseitenzugriff")}</span>}{plugin.sunoCss && <span>CSS</span>}{plugin.presets.length > 0 && <span>{plugin.presets.length} Presets</span>}{plugin.themes.length > 0 && <span>{plugin.themes.length}  {t("Themes")}</span>}</div></details><div className="card-actions"><SunoButton className="text-btn" onClick={() => setPluginDraft(JSON.stringify(plugin, null, 2))}><Code2 size={14} />{t("Bearbeiten")}</SunoButton><SunoButton className="icon-btn" title={t("Plugin exportieren")} aria-label={t('{name} exportieren', { name: plugin.name })} onClick={() => void run(() => bridge.saveJson(`${plugin.id}.plugin.json`, plugin, state.language))}><Download size={15} /></SunoButton><SunoButton className="icon-btn" title={t("Plugin entfernen")} aria-label={t('{name} entfernen', { name: plugin.name })} onClick={() => setState(old => ({ ...old, plugins: old.plugins.filter(p => p.id !== plugin.id) }))}><Trash2 size={15} /></SunoButton></div></section>)}
        {!state.plugins.length && <div className="empty"><h2>{t("Keine Plugins")}</h2><p>{t(".plugin.json oder .js importieren")}</p></div>}
        <SunoButton className="text-btn" onClick={() => void run(async () => { const response = await fetch(state.language === 'en' ? '/examples/song-tools.en.plugin.json' : '/examples/song-tools.plugin.json'); if (!response.ok) throw new Error('Beispiel konnte nicht geladen werden.'); installPlugin(parsePlugin(await response.text())); })}><Plus size={14} />{t("Song-Links kopieren hinzufügen")}</SunoButton>
        {pluginDraft !== null && <div className="section"><div className="card-heading"><h2>{t("Plugin-Editor")}</h2><SunoButton className="icon-btn" aria-label={t("Plugin-Editor schließen")} onClick={() => setPluginDraft(null)}><X size={16} /></SunoButton></div><textarea className="code-editor tall" aria-label={t("Plugin JSON")} value={pluginDraft} spellCheck={false} onChange={event => setPluginDraft(event.target.value)} /><SunoButton className="btn primary" onClick={() => void run(async () => { installPlugin(parsePlugin(pluginDraft)); setPluginDraft(null); })}><Save size={15} />{t("Speichern")}</SunoButton></div>}
      </>}

      {displayedPanel === 'themes' && <><div className="option-row first"><div><strong>{t("Theme aktivieren")}</strong></div><Switch label={t("Theme aktivieren")} value={state.siteThemeEnabled} change={siteThemeEnabled => setState(old => ({ ...old, siteThemeEnabled }))} /></div><div className="theme-list">{themes.map(item => <SunoButton key={item.id} aria-pressed={state.themeId === item.id} className={`theme-choice ${state.themeId === item.id ? 'selected' : ''}`} onClick={() => setState(old => ({ ...old, themeId: item.id, siteThemeEnabled: true }))}><div className="swatches">{[item.colors.background, item.colors.surface, item.colors.accent].map((color, i) => <i key={i} style={{ background: color }} />)}</div><span>{BUILTIN_THEMES.some(builtin => builtin.id === item.id) ? t(item.name) : item.name}</span>{state.themeId === item.id && <Check size={16} />}</SunoButton>)}</div><div className="button-row"><SunoButton className="btn" onClick={() => choose('theme')}><Upload size={15} />{t("Importieren")}</SunoButton><SunoButton className="btn" onClick={() => void run(() => bridge.saveJson('CustomSuno.theme.json', { ...theme, id: theme.id.startsWith('plugin:') ? `custom-${crypto.randomUUID()}` : theme.id }, state.language))}><Download size={15} />{t("Exportieren")}</SunoButton>{state.themes.some(t => t.id === theme.id) && <SunoButton className="icon-btn" title={t("Eigenes Theme entfernen")} aria-label={t("Eigenes Theme entfernen")} onClick={() => setState(old => ({ ...old, themeId: 'midnight', themes: old.themes.filter(t => t.id !== theme.id) }))}><Trash2 size={15} /></SunoButton>}</div><ThemeEditor language={state.language} theme={theme} editable={state.themes.some(t => t.id === theme.id)} onPreview={setThemePreview} onSave={(draft, copy) => { const custom = { ...draft, id: copy ? `custom-${crypto.randomUUID()}` : theme.id, description: draft.description }; setThemePreview(null); setState(old => ({ ...old, themes: copy ? [...old.themes, custom] : old.themes.map(t => t.id === custom.id ? custom : t), themeId: custom.id, siteThemeEnabled: true })); notify('Theme gespeichert und angewendet.'); }} /><details className="section advanced-css"><summary>{t("Eigenes CSS")}</summary><textarea className="code-editor" aria-label={t("Suno CSS")} spellCheck={false} placeholder={t("/* Wird bei jedem Seitenaufruf angewendet */\nbody { /* dein CSS */ }")} value={css} onChange={event => setCss(event.target.value)} /><SunoButton className="btn primary" onClick={() => void run(async () => { buildSunoCss(theme, state.plugins, css); setState(old => ({ ...old, sunoCss: css })); notify('CSS auf Suno angewendet.'); })}><Save size={15} />{t("CSS anwenden")}</SunoButton></details></>}

      {displayedPanel === 'downloads' && <MediaLibrary language={state.language} files={[...downloads.map(file => ({ ...file, metadata: state.library.find(saved => saved.path === file.path)?.metadata })), ...state.library.filter(file => !downloads.some(download => download.path === file.path))]} pending={pendingDownloads} onRefresh={async () => setDownloads(await bridge.listMedia())} onUpdate={(file, previousPath) => {
        setState(old => ({ ...old, library: [file, ...old.library.filter(entry => entry.path !== file.path && entry.path !== previousPath)] }));
        if (previousPath) setDownloads(old => old.map(entry => entry.path === previousPath ? file : entry));
      }} onEffects={loadAudio} onEditingChange={setMediaEditing} />}

      {displayedPanel === 'audio' && <><SunoButton className="btn primary wide" disabled={!!busy} onClick={() => choose('audio')}><Plus size={15} />{t("Audiodatei öffnen")}</SunoButton>{allAudio.length > 0 && <select className="audio-select" aria-label={t("Heruntergeladenen Track öffnen")} value="" disabled={!!busy} onChange={event => { const file = allAudio.find(f => f.path === event.target.value); if (file) void run(() => loadAudio(file)); }}><option value="">{t("Aus Mediathek wählen …")}</option>{allAudio.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}</select>}
        {track && <div className="audio-player"><strong>{track.name}</strong><small>{(track.sampleRate / 1000).toFixed(1)} kHz · {time(track.duration)}</small><div className="waveform" aria-hidden="true">{track.waveform.filter((_, i) => i % 2 === 0).map((v, i) => <i key={i} style={{ height: `${Math.max(4, v * 100)}%` }} />)}</div><input type="range" aria-label={t("Abspielposition")} min={0} max={track.duration} step={.05} value={position} onChange={event => engine.current.seek(Number(event.target.value))} /><div className="play-controls"><SunoButton className="play" aria-label={playing ? t("Pausieren") : t("Abspielen")} onClick={() => void run(async () => { if (engine.current.playing) engine.current.pause(); else await engine.current.play(); })}>{playing ? <Pause size={17} /> : <Play size={17} />}</SunoButton><span>{time(position)} / {time(track.duration)}</span><SunoButton className={`btn small ${bypass ? 'selected' : ''}`} onClick={() => setBypass(!bypass)}>A/B · {bypass ? t("Original") : t("Bearbeitet")}</SunoButton></div><label className="volume"><Volume2 size={16} /><input type="range" min={0} max={1} step={.01} aria-label={t("Lautstärke")} value={state.volume} onChange={event => setState(old => ({ ...old, volume: Number(event.target.value) }))} /></label></div>}
        <div className="section"><div className="card-heading"><h2>{t("Equalizer")}</h2><SunoButton className="icon-btn" title={t("EQ zurücksetzen")} aria-label={t("EQ zurücksetzen")} onClick={() => audioUpdate({ gains: Array(10).fill(0), preamp: 0 })}><RotateCcw size={15} /></SunoButton></div><select aria-label={t("Audio-Preset")} defaultValue="" onChange={event => { const preset = presets.find(p => p.id === event.target.value); if (preset) { const { gains, preamp, warmth, clarity, compression, normalize, enhance } = preset; audioUpdate({ gains: [...gains], preamp, warmth, clarity, compression, normalize, enhance }); } }}><option value="" disabled>{t("Preset auswählen …")}</option>{presets.map(p => <option key={p.id} value={p.id}>{p.id.startsWith('plugin:') ? p.name : t(p.name)}</option>)}</select><div className="equalizer">{FREQUENCIES.map((frequency, i) => <label key={frequency}><output>{state.audio.gains[i] > 0 ? '+' : ''}{state.audio.gains[i]}</output><input type="range" aria-label={`${frequency} Hz`} min={-12} max={12} step={.5} value={state.audio.gains[i]} onChange={event => { const gains = [...state.audio.gains]; gains[i] = Number(event.target.value); audioUpdate({ gains }); }} /><span>{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span></label>)}</div><label className="range-label"><span>{t("Vorverstärkung")} <output>{state.audio.preamp} dB</output></span><input type="range" min={-18} max={12} step={.5} value={state.audio.preamp} onChange={event => audioUpdate({ preamp: Number(event.target.value) })} /></label></div>
        <div className="option-row"><div><strong>{t("Enhancer")}</strong></div><Switch label={t("Audio Enhancer aktivieren")} value={state.audio.enhance} change={enhance => audioUpdate({ enhance })} /></div>{state.audio.enhance && ([{ key: 'warmth', title: t("Wärme") }, { key: 'clarity', title: t("Klarheit") }, { key: 'compression', title: t("Kompression") }] as const).map(item => <label className="range-label" key={item.key}><span>{item.title}<output>{state.audio[item.key]} %</output></span><input type="range" min={0} max={100} value={state.audio[item.key]} disabled={!state.audio.enhance} onChange={event => audioUpdate({ [item.key]: Number(event.target.value) })} /></label>)}<div className="option-row"><div><strong>{t("Export normalisieren")}</strong><p>−1 dBFS</p></div><Switch label={t("Export normalisieren")} value={state.audio.normalize} change={normalize => audioUpdate({ normalize })} /></div><ExportFormatSelect language={state.language} value={exportFormat} onChange={setExportFormat} disabled={!!busy} /><SunoButton className="btn primary wide" disabled={!track || !!busy} onClick={() => void run(exportAudio)}>{busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{busy ? t(busy) : t('{format} exportieren', { format: exportFormat.toUpperCase() })}</SunoButton>
      </>}

      {displayedPanel === 'settings' && <>
        <div className="about-brand"><img src="/logo.png" alt="" /><div><h2>CustomSuno</h2><small>{t("Version")} {version}</small></div></div>
        <div className="section"><label htmlFor="app-language">{t("Sprache")}<select id="app-language" value={state.language} onChange={event => { const language = event.target.value; if (language === 'de' || language === 'en') setState(old => ({ ...old, language })); }}><option value="de" lang="de">Deutsch</option><option value="en" lang="en">English</option></select></label></div>
        <div className="section"><h2>{t("Backup")}</h2><p>{t("Einstellungen, Plugins und Themes. Ohne Cookies und Audiodateien.")}</p><div className="button-row"><SunoButton className="btn" onClick={() => void run(() => bridge.saveJson('CustomSuno-Backup.json', state, state.language))}><Download size={15} />{t("Exportieren")}</SunoButton><SunoButton className="btn" onClick={() => choose('backup')}><Upload size={15} />{t("Wiederherstellen")}</SunoButton></div><small>{t("Wiederherstellen ersetzt die aktuellen Einstellungen.")}</small></div>
        {!ready && <div className="section"><p>{t("Einstellungen konnten nicht geladen werden.")}</p><SunoButton className="btn" onClick={() => { setState(initialState()); setReady(true); }}>{t("Neue Konfiguration anlegen")}</SunoButton></div>}
        <div className="section settings-links"><SunoButton className="btn" onClick={() => void run(() => bridge.openFolder('data'))}><FolderOpen size={15} />{t("Datenordner öffnen")}</SunoButton><SunoButton className="btn" onClick={() => void run(bridge.openBrowser)}><ExternalLink size={15} />{t("Suno im Browser öffnen")}</SunoButton></div>
      </>}
    </div></aside>}
    {notice && <div className={`toolbar-notice ${panel ? '' : 'in-toolbar'} ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{t(notice.text)}</span><SunoButton aria-label={t("Hinweis schließen")} onClick={() => setNotice(null)}><X size={13} /></SunoButton></div>}
  </div>;
}
