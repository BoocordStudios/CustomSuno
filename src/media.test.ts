import { describe, expect, it } from 'vitest';
import { emptyMetadata, exportMedia, mergePcm, parseMetadata, trimPcm, type Pcm } from './media';
import { initialState, parseState } from './state';
const mono: Pcm = { channels: [Float32Array.from([.1, .2, .3, .4])], sampleRate: 8000 };
describe('media editing', () => {
  it('cuts on sample boundaries without changing the original', () => {
    const cut = trimPcm(mono, 1 / 8000, 3 / 8000);
    expect([...cut.channels[0]]).toEqual([...mono.channels[0].slice(1, 3)]);
    cut.channels[0][0] = 0;
    expect(mono.channels[0][1]).toBeCloseTo(.2);
  });
  it('rejects inverted, empty and out-of-range selections', () => {
    for (const [start, end] of [[1, 0], [0, 0], [-1, 1], [0, 99], [NaN, 1]]) expect(() => trimPcm(mono, start, end)).toThrow();
  });
  it('merges in requested order and duplicates mono into stereo', () => {
    const stereo = { ...mono, channels: [Float32Array.from([.5]), Float32Array.from([-.5])] };
    const result = mergePcm([stereo, mono]);
    expect([...result.channels[0]]).toEqual([.5, ...mono.channels[0]]);
    expect([...result.channels[1]]).toEqual([-.5, ...mono.channels[0]]);
    expect(() => mergePcm([mono, { ...mono, sampleRate: 44100 }])).toThrow();
  });
  it('writes PCM data and bounded ID3 title/lyrics/cover chunks with correct RIFF size', () => {
    const wav = exportMedia(mono, { title: 'Titel ä', artist: 'Künstler', lyrics: 'Zeile eins\nZeile zwei', cover: 'data:image/png;base64,iVBORw0KGgo=' });
    const view = new DataView(wav.buffer);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBeCloseTo(.1 * 32767, -1);
    const id3Chunk = 44 + 8;
    expect(new TextDecoder().decode(wav.slice(id3Chunk, id3Chunk + 4))).toBe('id3 ');
    const tagSize = view.getUint32(id3Chunk + 4, true);
    expect(wav.length).toBe(id3Chunk + 8 + tagSize + tagSize % 2);
    const decoded = new TextDecoder().decode(wav);
    for (const value of ['TIT2', 'TPE1', 'APIC', 'USLT', 'Titel ä', 'Zeile eins\nZeile zwei']) expect(decoded).toContain(value);
  });
  it('preserves metadata in workspace backups and rejects executable covers', () => {
    const metadata = { ...emptyMetadata, title: 'Mein Titel', lyrics: 'Hallo\nWelt' };
    const state = parseState({ ...initialState(), library: [{ name: 'Song.wav', path: 'C:/Downloads/Song.wav', size: 100, metadata }] });
    expect(state.library[0].metadata).toEqual(metadata);
    expect(parseMetadata({ cover: 'javascript:alert(1)' }).cover).toBe('');
  });
});
