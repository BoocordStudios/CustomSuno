import { describe, expect, it } from 'vitest';
import { createWaveform, DEFAULT_AUDIO_SETTINGS, encodeWav, sanitizeAudioSettings } from './audio';

describe('PCM16 WAV encoding', () => {
  it('writes a valid stereo RIFF header and interleaves channels in little-endian order', () => {
    const bytes = encodeWav([new Float32Array([-1, 0.5]), new Float32Array([1, -0.5])], 48000);
    const view = new DataView(bytes.buffer);
    const text = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(text(12, 16)).toBe('fmt ');
    expect(text(36, 40)).toBe('data');
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(192000);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([44, 46, 48, 50].map((offset) => view.getInt16(offset, true))).toEqual([-32768, 32767, 16384, -16384]);
  });

  it('normalizes stereo to −1 dBFS with one gain shared by both channels', () => {
    const bytes = encodeWav([new Float32Array([0.25]), new Float32Array([-0.5])], 44100, true);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true) / 32767).toBeCloseTo(10 ** (-1 / 20) / 2, 4);
    expect(view.getInt16(46, true) / 32768).toBeCloseTo(-(10 ** (-1 / 20)), 4);
  });

  it('keeps silence finite when normalizing and handles invalid floating-point samples', () => {
    const bytes = encodeWav([new Float32Array([0, NaN, Infinity, -Infinity])], 44100, true);
    const view = new DataView(bytes.buffer);
    expect([44, 46, 48, 50].map((offset) => view.getInt16(offset, true))).toEqual([0, 0, 0, 0]);
  });

  it('saturates over-range samples instead of integer wraparound', () => {
    const bytes = encodeWav([new Float32Array([-3, 3])], 44100);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
  });

  it('rejects invalid channel layouts and rates', () => {
    expect(() => encodeWav([], 44100)).toThrow(/Mono/);
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 44100)).toThrow(/Längen/);
    expect(() => encodeWav([new Float32Array(2)], NaN)).toThrow(/Abtastrate/);
  });
});

describe('audio settings validation', () => {
  it('clamps corrupt settings and supplies missing EQ bands', () => {
    const clean = sanitizeAudioSettings({
      ...DEFAULT_AUDIO_SETTINGS,
      gains: [NaN, 100, -100],
      preamp: Infinity,
      warmth: -3,
      clarity: 101,
      compression: NaN,
    });
    expect(clean.gains).toEqual([0, 12, -12, 0, 0, 0, 0, 0, 0, 0]);
    expect(clean.preamp).toBe(0);
    expect(clean.warmth).toBe(0);
    expect(clean.clarity).toBe(100);
    expect(clean.compression).toBe(25);
  });

  it('copies gain arrays so presets and exports cannot change through shared references', () => {
    const clean = sanitizeAudioSettings(DEFAULT_AUDIO_SETTINGS);
    clean.gains[0] = 10;
    expect(DEFAULT_AUDIO_SETTINGS.gains[0]).toBe(0);
  });
});

describe('waveform overview', () => {
  it('captures peaks from both channels including the final sample', () => {
    const result = createWaveform([
      new Float32Array([0.1, -0.2, 0.3, 0.4, 0]),
      new Float32Array([0, 0, 0, 0, -0.9]),
    ], 2);
    expect(result[0]).toBeCloseTo(0.2);
    expect(result[1]).toBeCloseTo(0.9);
  });

  it('produces safe values for silence, invalid samples, and very short files', () => {
    expect(createWaveform([], 3)).toEqual([0, 0, 0]);
    expect(createWaveform([new Float32Array([NaN, Infinity])], 2)).toEqual([0, 0]);
    expect(createWaveform([new Float32Array([1])], 3)).toEqual([1, 1, 1]);
  });
});
