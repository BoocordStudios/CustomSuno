import ExportFormatSelect from './ExportFormatSelect';
import { translator, type Language } from './i18n';
import { encodeExport, type ExportFormat } from './audio-export';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FolderOpen, Music2, Plus, RotateCcw, Save, Scissors, X } from 'lucide-react';
import SunoButton from './SunoButton';
import * as bridge from './bridge';
import { createWaveform, encodeWav } from './audio';
import { emptyMetadata, exportMedia, mergePcm, parseMetadata, trimPcm, validatePcm, type Pcm, type TrackMetadata } from './media';
import { importBackgroundImage } from './theme-background';

const audioFile = (file: bridge.AudioFile) => /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|webm)$/i.test(file.name);
const seconds = (value: number) => `${Math.floor(value / 60)}:${(value % 60).toFixed(2).padStart(5, '0')}`;
export default function MediaLibrary({ files, pending, onUpdate, onRefresh, onEffects, onEditingChange, language }: {
  language: Language;
  files: bridge.AudioFile[]; pending: string[];
  onUpdate: (file: bridge.AudioFile, previousPath?: string) => void;
  onRefresh: () => Promise<void>;
  onEffects: (file: bridge.AudioFile) => Promise<void>;
  onEditingChange: (editing: boolean) => void;
}) {
  const t = translator(language);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<bridge.AudioFile | null>(null);
  const [metadata, setMetadata] = useState<TrackMetadata>(emptyMetadata);
  const [filename, setFilename] = useState('');
  const [pcm, setPcm] = useState<Pcm | null>(null);
  const [previous, setPrevious] = useState<{ pcm: Pcm; dirty: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [start, setStart] = useState(0), [end, setEnd] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [busy, setBusy] = useState(''), [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const [wave, setWave] = useState<number[]>([]);
  const player = useRef<HTMLAudioElement>(null), input = useRef<HTMLInputElement>(null);
  const audition = useRef(false), mounted = useRef(true), working = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { onEditingChange(dirty || !!busy); return () => onEditingChange(false); }, [dirty, busy, onEditingChange]);
  useEffect(() => {
    if (!pcm) return;
    const next = URL.createObjectURL(new Blob([encodeWav(pcm.channels, pcm.sampleRate)], { type: 'audio/wav' }));
    setUrl(next); setWave(createWaveform(pcm.channels, 120)); setStart(0); setEnd(pcm.channels[0].length / pcm.sampleRate); audition.current = false;
    return () => URL.revokeObjectURL(next);
  }, [pcm]);
  const duration = pcm ? pcm.channels[0].length / pcm.sampleRate : 0;
  const run = async (label: string, action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(label); setMessage(''); player.current?.pause();
    try { await new Promise(resolve => setTimeout(resolve, 0)); await action(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; if (mounted.current) setBusy(''); }
  };
  const decode = async (file: bridge.AudioFile, context: AudioContext): Promise<Pcm> => {
    const buffer = await context.decodeAudioData(await bridge.readAudio(file));
    const result = { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) };
    validatePcm(result); return result;
  };
  const open = async (file: bridge.AudioFile) => {
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      const decoded = await decode(file, context);
      if (!mounted.current) return;
      setSelected(file); setFilename(file.name); setMetadata({ ...parseMetadata(file.metadata), title: file.metadata?.title || file.name.replace(/\.[^.]+$/, '') }); setPcm(decoded); setPrevious(null); setDirty(false);
    } finally { await context.close(); }
  };
  const updateMetadata = (change: Partial<TrackMetadata>) => {
    const next = parseMetadata({ ...metadata, ...change }); setMetadata(next);
    if (selected && !dirty) { const entry = { ...selected, metadata: next }; setSelected(entry); onUpdate(entry); }
  };
  const save = async (): Promise<bridge.AudioFile> => {
    if (!pcm) throw new Error('Bitte zuerst einen Titel öffnen.');
    const name = `${(metadata.title || filename || t('Bearbeitet')).replace(/\.[^.]+$/, '')}-bearbeitet.wav`;
    const file = { ...await bridge.saveMedia(name, exportMedia(pcm, metadata)), metadata };
    onUpdate(file); if (mounted.current) { setSelected(file); setFilename(file.name); setDirty(false); setPrevious(null); setMessage('Neue WAV in der Mediathek gespeichert.'); }
    return file;
  };
  const merge = async () => {
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      const parts: Pcm[] = []; let bytes = 0, total = 0;
      for (const path of queue) {
        const file = files.find(f => f.path === path); if (!file) throw new Error('Ein Titel der Zusammenstellung fehlt.');
        const part = await decode(file, context); bytes += part.channels.reduce((n, c) => n + c.byteLength, 0); total += part.channels[0].length / part.sampleRate;
        if (bytes > 256 * 1024 * 1024 || total > 1200) throw new Error('Die Zusammenstellung ist zu groß. Bitte weniger Titel wählen.');
        parts.push(part);
      }
      const merged = mergePcm(parts);
      if (!mounted.current) return;
      setPcm(merged); setPrevious(null); setSelected(null); setFilename(`${t('Zusammenstellung')}.wav`); setMetadata({ ...emptyMetadata, title: t('Zusammenstellung') }); setDirty(true);
    } finally { await context.close(); }
  };
  const visible = files.filter(f => `${f.name} ${f.metadata?.title ?? ''} ${f.metadata?.artist ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="media-library">
    <input ref={input} className="hidden-input" type="file" accept="audio/*" aria-label={t("Audio in Mediathek importieren")} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('Importieren …', async () => { const entry = await bridge.importAudio(file, language); if (entry) { onUpdate(entry); await open(entry); } }); }} />
    <fieldset disabled={!!busy}>
      <div className="button-row"><SunoButton className="btn primary" disabled={dirty} onClick={() => { if (!bridge.desktop) input.current?.click(); else void run('Importieren …', async () => { const file = await bridge.importAudio(undefined, language); if (file) { onUpdate(file); await open(file); } }); }}><Plus size={15} />{t("Importieren")}</SunoButton><SunoButton className="icon-btn" title={t("Aktualisieren")} aria-label={t("Mediathek aktualisieren")} onClick={() => void run('Aktualisieren …', onRefresh)}><RotateCcw size={16} /></SunoButton><SunoButton className="icon-btn" title={t("Downloadordner öffnen")} aria-label={t("Downloadordner öffnen")} onClick={() => void run('Ordner öffnen …', () => bridge.openFolder('downloads'))}><FolderOpen size={16} /></SunoButton></div>
      <label className="media-search"><input aria-label={t("Mediathek durchsuchen")} type="search" value={query} placeholder={t("Mediathek durchsuchen")} onChange={event => setQuery(event.target.value)} /></label>
      {pending.map((name, i) => <p key={i}>{name} · {t("Download läuft …")}</p>)}
      <div className="media-list">{visible.map(file => <div className={`media-row ${selected?.path === file.path ? 'selected' : ''}`} key={file.path}>
        {file.metadata?.cover ? <img src={file.metadata.cover} alt={t("Cover")} /> : <Music2 size={28} />}
        <div><strong>{file.metadata?.title || file.name}</strong><small>{file.metadata?.artist ? file.metadata.artist + ' · ' : ''}{file.name} · {(file.size / 1048576).toFixed(1)} MB</small>
          {audioFile(file) ? <div className="button-row"><SunoButton className="text-btn" disabled={dirty} onClick={() => void run('Audio laden …', () => open(file))}>{t("Bearbeiten")}</SunoButton><SunoButton className="text-btn" disabled={queue.includes(file.path)} onClick={() => setQueue(old => [...old, file.path])}>{t("Zusammenfügen")}</SunoButton></div> : <small>{t("Im Downloadordner")}</small>}
        </div>
      </div>)}</div>
      {!visible.length && <p className="empty">{query ? t("Keine passenden Dateien.") : t("Noch keine Dateien.")}</p>}
      {queue.length > 0 && <section className="section"><h2>{t("Zusammenfügen")}</h2>{queue.map((path, i) => <div className="merge-row" key={path}><span>{i + 1}. {files.find(f => f.path === path)?.name ?? t("Datei fehlt")}</span><SunoButton className="icon-btn" aria-label={t('Titel {index} nach oben', { index: i + 1 })} disabled={i === 0} onClick={() => setQueue(old => { const next = [...old]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })}><ArrowUp size={14} /></SunoButton><SunoButton className="icon-btn" aria-label={t('Titel {index} nach unten', { index: i + 1 })} disabled={i === queue.length - 1} onClick={() => setQueue(old => { const next = [...old]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; return next; })}><ArrowDown size={14} /></SunoButton><SunoButton className="icon-btn" aria-label={t('Titel {index} aus Merge entfernen', { index: i + 1 })} onClick={() => setQueue(old => old.filter(p => p !== path))}><X size={14} /></SunoButton></div>)}<SunoButton className="btn" disabled={queue.length < 2 || dirty} onClick={() => void run('Titel zusammenfügen …', merge)}>{t("Titel zusammenfügen")}</SunoButton><p className="footnote">{t("Ohne Überblendung · 48 kHz")}</p></section>}
      {pcm && <section className="section media-editor"><h2>{selected?.name || t("Neue Zusammenstellung")}</h2>
        <audio ref={player} controls src={url} onTimeUpdate={() => { if (audition.current && player.current && player.current.currentTime >= end) { player.current.pause(); audition.current = false; } }} />
        <div className="waveform media-wave" aria-label={t("Wellenform")}>{wave.map((value, i) => <i key={i} style={{ height: `${Math.max(3, value * 100)}%`, opacity: i / wave.length * duration >= start && i / wave.length * duration <= end ? 1 : .2 }} />)}</div>
        <p>{seconds(duration)} · {pcm.channels.length === 1 ? t("Mono") : t("Stereo")} · {pcm.sampleRate} Hz</p>
        <div className="trim-values"><label>{t("Start (Sekunden)")}<input type="number" min={0} max={duration} step="0.01" value={start} onChange={event => setStart(Number(event.target.value))} /></label><label>{t("Ende (Sekunden)")}<input type="number" min={0} max={duration} step="0.01" value={end} onChange={event => setEnd(Number(event.target.value))} /></label></div>
        <label>{t("Start verschieben")}<input type="range" min={0} max={duration} step="0.01" value={start} onChange={event => setStart(Number(event.target.value))} /></label><label>{t("Ende verschieben")}<input type="range" min={0} max={duration} step="0.01" value={end} onChange={event => setEnd(Number(event.target.value))} /></label>
        <div className="button-row"><SunoButton className="btn" disabled={start >= end || start < 0 || end > duration} onClick={() => { if (player.current) { player.current.currentTime = start; audition.current = true; void player.current.play().catch(error => setMessage(String(error))); } }}>{t("Auswahl anhören")}</SunoButton><SunoButton className="btn" onClick={() => void run('Zuschneiden …', async () => { const cut = trimPcm(pcm, start, end); setPrevious({ pcm, dirty }); setPcm(cut); setDirty(true); })}><Scissors size={15} />{t("Auswahl behalten")}</SunoButton><SunoButton className="icon-btn" aria-label={t("Letzten Schnitt rückgängig")} disabled={!previous} onClick={() => { if (previous) { setPcm(previous.pcm); setDirty(previous.dirty); setPrevious(null); } }}><RotateCcw size={15} /></SunoButton></div>
        {dirty && <><p role="status">{t("Ungespeicherte Änderungen")}</p><SunoButton className="text-btn" onClick={() => { setPcm(null); setSelected(null); setPrevious(null); setDirty(false); }}>{t("Bearbeitung verwerfen")}</SunoButton></>}
        {selected && <><label>{t("Dateiname")}<input value={filename} maxLength={180} onChange={event => setFilename(event.target.value)} /></label><SunoButton className="btn" disabled={dirty} onClick={() => void run('Umbenennen …', async () => { const renamed = { ...await bridge.renameMedia(selected, filename), metadata }; onUpdate(renamed, selected.path); setQueue(old => old.map(p => p === selected.path ? renamed.path : p)); setSelected(renamed); setFilename(renamed.name); setMessage('Datei umbenannt.'); })}>{t("Datei umbenennen")}</SunoButton></>}
        <details className="media-metadata"><summary>{t("Songinformationen")}</summary>
        <label>{t("Titel")}<input value={metadata.title} maxLength={200} onChange={event => updateMetadata({ title: event.target.value })} /></label><label>{t("Künstler")}<input value={metadata.artist} maxLength={200} onChange={event => updateMetadata({ artist: event.target.value })} /></label>
        {metadata.cover && <img className="media-cover" src={metadata.cover} alt={t("Songcover")} />}
        <label>{t("Cover auswählen")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('Cover laden …', async () => updateMetadata({ cover: await importBackgroundImage(file, 'image/jpeg') })); }} /></label>{metadata.cover && <SunoButton className="text-btn" onClick={() => updateMetadata({ cover: '' })}>{t("Cover entfernen")}</SunoButton>}
        <label>{t("Songtext")}<textarea className="lyrics-editor" value={metadata.lyrics} maxLength={40000} placeholder={t("Songtext")} onChange={event => updateMetadata({ lyrics: event.target.value })} /></label>
        </details>
        <ExportFormatSelect language={language} value={exportFormat} onChange={setExportFormat} disabled={!!busy} /><div className="button-row"><SunoButton className="btn primary" onClick={() => void run('Version speichern …', async () => { await save(); })}><Save size={15} />{t("Neue Version speichern")}</SunoButton><SunoButton className="btn" onClick={() => void run('Audio exportieren …', async () => { const bytes = await encodeExport(exportMedia(pcm, metadata), exportFormat, setBusy, metadata); const saved = await bridge.saveAudio(`${metadata.title || 'CustomSuno'}.${exportFormat}`, bytes, exportFormat, language); if (saved) setMessage(`${exportFormat.toUpperCase()} exportiert.`); })}><Download size={15} />{t('{format} exportieren', { format: exportFormat.toUpperCase() })}</SunoButton><SunoButton className="btn" onClick={() => void run('Equalizer öffnen …', async () => { const file = await save(); await onEffects(file); })}>{t("Speichern & Equalizer")}</SunoButton></div>
        <p className="footnote">{t("Neue Version: WAV · 16 Bit. Original bleibt erhalten.")}</p>
      </section>}
    </fieldset>
    {(busy || message) && <p className="media-status" role="status">{t(busy || message)}</p>}
  </div>;
}
