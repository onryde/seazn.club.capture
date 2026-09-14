import { describe, expect, it } from 'vitest';
import { type Verdict, head, initialWatch, judge, parseVariant, step, variantUris } from './playlist.ts';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720',
  'stream_1/video.m3u8',
  '',
].join('\n');

const variant = (sequence: number, segments: number, ended = false, targetDuration = 4) =>
  [
    '#EXTM3U',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    ...Array.from({ length: segments }, (_, i) => `#EXTINF:4.0,\nseg${sequence + i}.ts`),
    ...(ended ? ['#EXT-X-ENDLIST'] : []),
  ].join('\n');

/** Three of the engine's 2 s segments: the threshold every watcher on this spike runs with. */
const STALL_MS = 6000;

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
    expect(judge(null, at(10, 3), 0, 1000, STALL_MS)).toEqual({ verdict: 'waiting', lastAdvanceMs: 1000 });
  });

  it('calls a sliding window advancing even at a constant segment count', () => {
    expect(head(at(11, 3))).toBeGreaterThan(head(at(10, 3)));
    expect(judge(at(10, 3), at(11, 3), 1000, 4000, STALL_MS).verdict).toBe('advancing');
  });

  it('calls a still head holding inside the stall threshold, never advancing', () => {
    expect(judge(at(10, 3), at(10, 3), 1000, 5000, STALL_MS).verdict).toBe('holding');
  });

  it('calls a stall once the head is frozen past the threshold — U1-S7 fires no error', () => {
    expect(judge(at(10, 3), at(10, 3), 1000, 14_000, STALL_MS)).toEqual({
      verdict: 'stalled',
      lastAdvanceMs: 1000,
    });
  });

  /**
   * The playlist here declares a target duration of 4, which the old rule turned
   * into a 12 s threshold. The threshold is ours, not the platform's: 7 s of a
   * frozen head is a stall on 2 s segments whatever the playlist says.
   */
  it('takes the threshold it is given, not the playlist target duration', () => {
    expect(judge(at(10, 3), at(10, 3), 1000, 8000, STALL_MS).verdict).toBe('stalled');
  });

  it('calls ENDLIST ended, whatever the timing', () => {
    expect(judge(at(10, 3), parseVariant(variant(10, 3, true)), 0, 1, STALL_MS).verdict).toBe('ended');
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
      const polled = step(state, `https://c.example/v${poll}.m3u8`, at(10, 3), 1000 + poll * 2000, STALL_MS);
      state = polled.state;
      verdicts.push(polled.verdict);
    }
    expect(verdicts).not.toContain('advancing');
    expect(verdicts.at(-1)).toBe('stalled');
  });

  it('calls a healthy reconnect advancing again as soon as its new variant moves', () => {
    const first = step(initialWatch, 'https://c.example/a.m3u8', at(10, 3), 1000, STALL_MS);
    const reconnected = step(first.state, 'https://c.example/b.m3u8', at(0, 2), 3000, STALL_MS);
    const moving = step(reconnected.state, 'https://c.example/b.m3u8', at(0, 3), 5000, STALL_MS);
    expect(reconnected.verdict).toBe('waiting');
    expect(moving.verdict).toBe('advancing');
  });

  it('keeps comparing heads within one variant', () => {
    const first = step(initialWatch, 'https://c.example/a.m3u8', at(10, 3), 1000, STALL_MS);
    expect(step(first.state, 'https://c.example/a.m3u8', at(11, 3), 3000, STALL_MS).verdict).toBe('advancing');
  });

  /**
   * Cloudflare rotates `lps` and `rcu` on every request, so keying on the whole
   * URL makes every poll a new variant and a healthy stream reads stalled. This
   * was caught one minute into Run A by watching a head move while the verdict
   * said `waiting` — not by a test. Hence this test.
   */
  it('treats a rotated query string as the same variant', () => {
    const a = 'https://c.example/v.m3u8?llhlsHBs=0.9&lps=aaa&rcu=1';
    const b = 'https://c.example/v.m3u8?llhlsHBs=0.9&lps=bbb&rcu=2';
    const first = step(initialWatch, a, at(10, 3), 1000, STALL_MS);
    expect(step(first.state, b, at(11, 3), 3000, STALL_MS).verdict).toBe('advancing');
  });

  /**
   * F-P5-4. In the 2026-09-13 retry Cloudflare's declared target duration went
   * 3 -> 4 -> 7 -> 8 in the 90 s after the first reconnect and stayed at 8, and a
   * threshold of three target durations became 24 s: 286 polls, not one stall.
   * A head frozen for 10 s after the playlist grows is still a stall.
   */
  it('stays sensitive after the playlist target duration grows', () => {
    const uri = 'https://c.example/v.m3u8';
    const grown = parseVariant(variant(11, 3, false, 8));
    const first = step(initialWatch, uri, at(10, 3), 1000, STALL_MS);
    const moved = step(first.state, uri, grown, 3000, STALL_MS);
    const frozen = step(moved.state, uri, grown, 13_000, STALL_MS);
    expect(moved.verdict).toBe('advancing');
    expect(frozen.verdict).toBe('stalled');
  });

  /**
   * The other edge. On 2026-09-14's two healthy cells the head never went longer
   * than 4.63 s between advances (p99 3.6-4.6 s, ~1.4 s polls), so a threshold
   * tightened to that would call a healthy stream stalled.
   */
  it('does not call the slowest healthy gap between advances a stall', () => {
    const uri = 'https://c.example/v.m3u8';
    const first = step(initialWatch, uri, at(10, 3), 1000, STALL_MS);
    const moved = step(first.state, uri, at(11, 3), 3000, STALL_MS);
    expect(step(moved.state, uri, at(11, 3), 7630, STALL_MS).verdict).toBe('holding');
  });
});
