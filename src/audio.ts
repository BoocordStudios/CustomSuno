/** Local-only audio processing. Playback and WAV export share the same DSP graph. */
export const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export type AudioSettings = {
  gains: number[];
  preamp: number;
  enhance: boolean;
  warmth: number;
  clarity: number;
  compression: number;
  normalize: boolean;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  gains: FREQUENCIES.map(() => 0),
  preamp: 0,
  enhance: false,
  warmth: 25,
  clarity: 20,
  compression: 25,
  normalize: true,
};

const MAX_FILE_BYTES = 192 * 1024 * 1024;
const MAX_DURATION = 20 * 60;
// Rendering needs another float buffer plus the encoded WAV. Bound decoded data, too.
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const PCM_PEAK = 10 ** (-1 / 20);
const ENCODE_CHUNK = 262144;

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function sanitizeAudioSettings(settings: AudioSettings): AudioSettings {
  return {
    gains: FREQUENCIES.map((_, index) => finite(settings?.gains?.[index], 0, -12, 12)),
    preamp: finite(settings?.preamp, 0, -18, 12),
    enhance: settings?.enhance === true,
    warmth: finite(settings?.warmth, 25, 0, 100),
    clarity: finite(settings?.clarity, 20, 0, 100),
    compression: finite(settings?.compression, 25, 0, 100),
    normalize: settings?.normalize === true,
  };
}

type ProcessingGraph = {
  input: GainNode;
  output: GainNode;
  eq: BiquadFilterNode[];
  warmth: BiquadFilterNode;
  clarity: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  disconnect(): void;
};

function setParam(param: AudioParam, value: number, time: number, smooth: boolean): void {
  param.cancelScheduledValues(time);
  if (smooth) param.setTargetAtTime(value, time, 0.015);
  else param.setValueAtTime(value, time);
}

function applySettings(
  graph: ProcessingGraph,
  context: BaseAudioContext,
  settings: AudioSettings,
  smooth: boolean,
): void {
  const apply = (param: AudioParam, value: number) => setParam(param, value, context.currentTime, smooth);
  apply(graph.input.gain, 10 ** (settings.preamp / 20));
  graph.eq.forEach((filter, index) => apply(filter.gain, settings.gains[index]));
  apply(graph.warmth.gain, settings.enhance ? settings.warmth * 0.06 : 0);
  apply(graph.clarity.gain, settings.enhance ? settings.clarity * 0.05 : 0);
  const amount = settings.enhance ? settings.compression / 100 : 0;
  apply(graph.compressor.threshold, -6 - amount * 24);
  apply(graph.compressor.knee, amount * 24);
  apply(graph.compressor.ratio, 1 + amount * 7);
  apply(graph.compressor.attack, 0.012);
  apply(graph.compressor.release, 0.2);
}

function createGraph(context: BaseAudioContext, settings: AudioSettings): ProcessingGraph {
  const input = context.createGain();
  const output = context.createGain();
  const eq = FREQUENCIES.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = Math.min(frequency, context.sampleRate * 0.49);
    filter.Q.value = 1.4;
    return filter;
  });
  const warmth = context.createBiquadFilter();
  warmth.type = 'lowshelf';
  warmth.frequency.value = 180;
  const clarity = context.createBiquadFilter();
  clarity.type = 'highshelf';
  clarity.frequency.value = Math.min(4200, context.sampleRate * 0.4);
  const compressor = context.createDynamicsCompressor();
  const nodes: AudioNode[] = [input, ...eq, warmth, clarity, compressor, output];
  nodes.slice(0, -1).forEach((node, index) => node.connect(nodes[index + 1]));
  const graph: ProcessingGraph = {
    input, output, eq, warmth, clarity, compressor,
    disconnect: () => nodes.forEach((node) => node.disconnect()),
  };
  applySettings(graph, context, settings, false);
  return graph;
}

export function createWaveform(channels: Float32Array[], count = 200): number[] {
  const length = channels[0]?.length ?? 0;
  const bins = Math.round(finite(count, 200, 1, 1000));
  return Array.from({ length: bins }, (_, bin) => {
    const start = Math.floor((bin * length) / bins);
    const end = Math.min(length, Math.max(start + 1, Math.floor(((bin + 1) * length) / bins)));
    let peak = 0;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        const sample = Math.abs(channel[frame]);
        if (Number.isFinite(sample)) peak = Math.max(peak, sample);
      }
    }
    return Math.min(1, peak);
  });
}

function waveBuffer(channels: Float32Array[], sampleRate: number): { bytes: Uint8Array; view: DataView } {
  if (channels.length < 1 || channels.length > 2) {
    throw new Error('Für den WAV-Export wird Mono- oder Stereo-Audio benötigt.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('Die Abtastrate dieser Audiodatei wird nicht unterstützt.');
  }
  const frames = channels[0].length;
  if (channels.some((channel) => channel.length !== frames)) {
    throw new Error('Die Audiokanäle haben unterschiedliche Längen.');
  }
  const size = frames * channels.length * 2;
  if (size > MAX_DECODED_BYTES / 2) throw new Error('Diese Audiodatei ist für den WAV-Export zu groß.');
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, size, true);
  return { bytes, view };
}

function samplePeak(channels: Float32Array[], start: number, end: number): number {
  let peak = 0;
  for (const channel of channels) {
    for (let frame = start; frame < end; frame++) {
      const sample = Math.abs(channel[frame]);
      if (Number.isFinite(sample)) peak = Math.max(peak, sample);
    }
  }
  return peak;
}

function encodeFrames(view: DataView, channels: Float32Array[], gain: number, start: number, end: number): void {
  let offset = 44 + start * channels.length * 2;
  for (let frame = start; frame < end; frame++) {
    for (const channel of channels) {
      const value = channel[frame] * gain;
      const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
}

/** PCM16 little-endian WAV. Linked stereo normalization preserves channel balance. */
export function encodeWav(channels: Float32Array[], sampleRate: number, normalize = false): Uint8Array {
  const { bytes, view } = waveBuffer(channels, sampleRate);
  const frames = channels[0].length;
  const peak = normalize ? samplePeak(channels, 0, frames) : 0;
  encodeFrames(view, channels, peak > 0 ? PCM_PEAK / peak : 1, 0, frames);
  return bytes;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function encodeWavAsync(
  buffer: AudioBuffer,
  normalize: boolean,
  onProgress?: (message: string) => void,
): Promise<Uint8Array> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  let peak = 0;
  if (normalize) {
    onProgress?.('Spitzenpegel auf −1 dBFS normalisieren …');
    for (let start = 0; start < buffer.length; start += ENCODE_CHUNK) {
      peak = Math.max(peak, samplePeak(channels, start, Math.min(buffer.length, start + ENCODE_CHUNK)));
      await yieldToUi();
    }
  }
  const { bytes, view } = waveBuffer(channels, buffer.sampleRate);
  const gain = normalize && peak > 0 ? PCM_PEAK / peak : 1;
  for (let start = 0; start < buffer.length; start += ENCODE_CHUNK) {
    const end = Math.min(buffer.length, start + ENCODE_CHUNK);
    encodeFrames(view, channels, gain, start, end);
    onProgress?.(`WAV kodieren … ${Math.round((end / buffer.length) * 100)} %`);
    await yieldToUi();
  }
  return bytes;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private graph: ProcessingGraph | null = null;
  private monitor: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private settings = sanitizeAudioSettings(DEFAULT_AUDIO_SETTINGS);
  private volume = 0.8;
  private offset = 0;
  private startedAt = 0;
  private loadVersion = 0;
  private transportVersion = 0;
  private disposed = false;
  private exporting = false;

  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error('Das Audiostudio wurde geschlossen.');
    if (!this.context) {
      if (typeof AudioContext === 'undefined') throw new Error('Web Audio ist in dieser WebView nicht verfügbar.');
      this.context = new AudioContext();
      this.graph = createGraph(this.context, this.settings);
      this.monitor = this.context.createGain();
      this.monitor.gain.value = this.volume;
      this.graph.output.connect(this.monitor);
      this.monitor.connect(this.context.destination);
    }
    return this.context;
  }

  async load(bytes: ArrayBuffer): Promise<{ duration: number; sampleRate: number; channels: number; waveform: number[] }> {
    if (!bytes.byteLength) throw new Error('Die gewählte Audiodatei ist leer.');
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Die Audiodatei ist zu groß. Bitte eine Datei unter 192 MB wählen.');
    const version = ++this.loadVersion;
    const context = this.ensureContext();
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(bytes.slice(0));
    } catch {
      throw new Error('Diese Datei konnte nicht gelesen werden. Bitte eine gültige MP3-, WAV-, FLAC-, OGG- oder M4A-Datei verwenden (Codec-Unterstützung abhängig von der WebView).');
    }
    if (this.disposed || version !== this.loadVersion) throw new Error('Dieser Import wurde abgebrochen oder durch einen neueren Import ersetzt.');
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('Die Audiodatei enthält keine abspielbaren Audiodaten.');
    if (decoded.duration > MAX_DURATION) throw new Error('Bitte einen Titel mit höchstens 20 Minuten Länge verwenden.');
    if (decoded.numberOfChannels > 2) throw new Error('Bitte eine Mono- oder Stereo-Datei verwenden. Mehrkanal-Audio wird nicht unterstützt.');
    if (decoded.length * decoded.numberOfChannels * 4 > MAX_DECODED_BYTES) {
      throw new Error('Die entpackte Audiodatei benötigt zu viel Arbeitsspeicher (max. 256 MB). Bitte einen kürzeren Titel oder eine Mono-Version verwenden.');
    }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const waveform = createWaveform(channels);
    // Only commit a decoded and validated file; failed imports preserve the current track.
    this.pause();
    this.buffer = decoded;
    this.offset = 0;
    return { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, waveform };
  }

  get currentTime(): number {
    if (!this.source || !this.context) return this.offset;
    return Math.min(this.duration, this.offset + Math.max(0, this.context.currentTime - this.startedAt));
  }

  get duration(): number { return this.buffer?.duration ?? 0; }
  get playing(): boolean { return this.source !== null; }

  private startSource(): void {
    if (!this.buffer || !this.context || !this.graph) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.graph.input);
    source.onended = () => {
      source.disconnect();
      if (this.source === source) {
        this.source = null;
        this.offset = this.duration;
      }
    };
    this.startedAt = this.context.currentTime;
    this.source = source;
    source.start(0, this.offset);
  }

  async play(): Promise<void> {
    if (!this.buffer) throw new Error('Bitte zuerst einen heruntergeladenen Titel importieren.');
    if (this.playing) return;
    const context = this.ensureContext();
    const version = ++this.transportVersion;
    await context.resume();
    if (this.disposed || version !== this.transportVersion) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.startSource();
  }

  pause(): void {
    ++this.transportVersion;
    this.offset = this.currentTime;
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
  }

  seek(seconds: number): void {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = finite(seconds, 0, 0, this.duration);
    if (wasPlaying && this.offset < this.duration) this.startSource();
  }

  update(settings: AudioSettings): void {
    this.settings = sanitizeAudioSettings(settings);
    if (this.graph && this.context) applySettings(this.graph, this.context, this.settings, true);
  }

  setVolume(value: number): void {
    this.volume = finite(value, 0.8, 0, 1);
    if (this.monitor && this.context) setParam(this.monitor.gain, this.volume, this.context.currentTime, true);
  }

  async exportWav(onProgress?: (message: string) => void): Promise<Uint8Array> {
    if (this.disposed) throw new Error('Das Audiostudio wurde geschlossen.');
    if (!this.buffer) throw new Error('Bitte zuerst einen heruntergeladenen Titel importieren.');
    if (this.exporting) throw new Error('Ein WAV-Export läuft bereits. Bitte warten.');
    if (typeof OfflineAudioContext === 'undefined') throw new Error('Audio-Export ist in dieser WebView nicht verfügbar.');
    this.exporting = true;
    // Capture a consistent source and settings even if the user keeps editing during export.
    const buffer = this.buffer;
    const settings = sanitizeAudioSettings(this.settings);
    let graph: ProcessingGraph | undefined;
    let source: AudioBufferSourceNode | undefined;
    try {
      onProgress?.('Equalizer und Enhancer berechnen …');
      const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
      graph = createGraph(context, settings);
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(graph.input);
      graph.output.connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      const bytes = await encodeWavAsync(rendered, settings.normalize, onProgress);
      onProgress?.('WAV bereit zum Speichern.');
      return bytes;
    } finally {
      source?.disconnect();
      graph?.disconnect();
      this.exporting = false;
    }
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
    ++this.loadVersion;
    this.buffer = null;
    this.offset = 0;
    this.graph?.disconnect();
    this.monitor?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => undefined);
    this.context = null;
    this.graph = null;
    this.monitor = null;
  }
}
