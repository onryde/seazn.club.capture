import { describe, expect, it } from 'vitest';
import { type Verdict, head, initialWatch, judge, parseVariant, step, variantUris } from './playlist.ts';

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

  it('calls the first poll waiting, not advancing, and starts the clock', () => {
    expect(judge(null, at(10, 3), 0, 1000)).toEqual({ verdict: 'waiting', lastAdvanceMs: 1000 });
  });

  it('calls a sliding window advancing even at a constant segment count', () => {
    expect(head(at(11, 3))).toBeGreaterThan(head(at(10, 3)));
    expect(judge(at(10, 3), at(11, 3), 1000, 4000).verdict).toBe('advancing');
  });

  it('calls a still head holding inside three target durations, never advancing', () => {
    expect(judge(at(10, 3), at(10, 3), 1000, 5000).verdict).toBe('holding');
  });

  it('calls a stall after three target durations — U1-S7 fires no error', () => {
    expect(judge(at(10, 3), at(10, 3), 1000, 14_000)).toEqual({
      verdict: 'stalled',
      lastAdvanceMs: 1000,
    });
  });

  it('calls ENDLIST ended, whatever the timing', () => {
    expect(judge(at(10, 3), parseVariant(variant(10, 3, true)), 0, 1).verdict).toBe('ended');
  });
});

describe('step — the watcher loop', () => {
  const at = (sequence: number, segments: number) => parseVariant(variant(sequence, segments));

  /**
   * F-P5-2. Every reconnect publishes a new variant URI, and on the run that
   * produced this finding the head moved on 9 of ~76 polls while the watcher
   * said `advancing` on all of them. Reverting the carry of `lastAdvanceMs`
   * across a variant change turns this test red, which is the point of it.
   */
  it('calls a reconnect storm stalled, though every poll brings a new variant', () => {
    let state = initialWatch;
    const verdicts: Verdict[] = [];
    for (let poll = 0; poll < 10; poll += 1) {
      const polled = step(state, `https://c.example/v${poll}.m3u8`, at(10, 3), 1000 + poll * 2000);
      state = polled.state;
      verdicts.push(polled.verdict);
    }
    expect(verdicts).not.toContain('advancing');
    expect(verdicts.at(-1)).toBe('stalled');
  });

  it('calls a healthy reconnect advancing again as soon as its new variant moves', () => {
    const first = step(initialWatch, 'https://c.example/a.m3u8', at(10, 3), 1000);
    const reconnected = step(first.state, 'https://c.example/b.m3u8', at(0, 2), 3000);
    const moving = step(reconnected.state, 'https://c.example/b.m3u8', at(0, 3), 5000);
    expect(reconnected.verdict).toBe('waiting');
    expect(moving.verdict).toBe('advancing');
  });

  it('keeps comparing heads within one variant', () => {
    const first = step(initialWatch, 'https://c.example/a.m3u8', at(10, 3), 1000);
    expect(step(first.state, 'https://c.example/a.m3u8', at(11, 3), 3000).verdict).toBe('advancing');
  });
});
