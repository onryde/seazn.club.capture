import { describe, expect, it } from 'vitest';
import { head, judge, parseVariant, variantUris } from './playlist.ts';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720',
  'stream_1/video.m3u8',
  '',
].join('\n');

const variant = (sequence: number, segments: number, ended = false) =>
  [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:4',
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    ...Array.from({ length: segments }, (_, i) => `#EXTINF:4.0,\nseg${sequence + i}.ts`),
    ...(ended ? ['#EXT-X-ENDLIST'] : []),
  ].join('\n');

describe('variantUris', () => {
  it('resolves variant paths against the master URL', () => {
    expect(variantUris(MASTER, 'https://c.example/uid/manifest/video.m3u8')).toEqual([
      'https://c.example/uid/manifest/stream_1/video.m3u8',
    ]);
  });
});

describe('parseVariant', () => {
  it('reads sequence, segment count, target duration and ENDLIST', () => {
    expect(parseVariant(variant(10, 3, true))).toEqual({
      mediaSequence: 10,
      segments: 3,
      endList: true,
      targetDuration: 4,
    });
  });
});

describe('judge', () => {
  const at = (sequence: number, segments: number) => parseVariant(variant(sequence, segments));

  it('calls the first poll advancing', () => {
    expect(judge(null, at(10, 3), 0, 1000)).toEqual({ verdict: 'advancing', lastAdvanceMs: 1000 });
  });

  it('calls a sliding window advancing even at a constant segment count', () => {
    expect(head(at(11, 3))).toBeGreaterThan(head(at(10, 3)));
    expect(judge(at(10, 3), at(11, 3), 0, 4000).verdict).toBe('advancing');
  });

  it('does not call a stall inside three target durations', () => {
    expect(judge(at(10, 3), at(10, 3), 0, 11_000).verdict).toBe('advancing');
  });

  it('calls a stall after three target durations — U1-S7 fires no error', () => {
    expect(judge(at(10, 3), at(10, 3), 0, 13_000)).toEqual({ verdict: 'stalled', lastAdvanceMs: 0 });
  });

  it('calls ENDLIST ended, whatever the timing', () => {
    expect(judge(at(10, 3), parseVariant(variant(10, 3, true)), 0, 1).verdict).toBe('ended');
  });
});
