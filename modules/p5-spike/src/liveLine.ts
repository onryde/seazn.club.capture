import type { SpikeSample } from './P5SpikeModule';

export type LiveLine = { readonly text: string; readonly tone: 'plain' | 'caution' };

/**
 * The HUD's first line. F-P5-6: for eleven minutes it read `LIVE srt` while the encoder had no
 * picture, because it was keyed on the streaming flag. It now says LIVE only when native reports
 * video frames advancing (AGENTS.md §6: one status line that always says something true). Native
 * computes `videoState`; this only words it.
 *
 * No `wanted` is needed here: native returns to `idle` on every operator intent, so
 * `stalled`, `recovering` and `failed` only ever exist while a publish is wanted.
 */
export function liveLine(sample: Pick<SpikeSample, 'streaming' | 'transport' | 'videoState'>): LiveLine {
  switch (sample.videoState) {
    case 'ok':
      return { text: `LIVE ${sample.transport ?? ''}`, tone: 'plain' };
    case 'stalled':
    case 'recovering':
      return { text: 'NO VIDEO — recovering', tone: 'caution' };
    case 'failed':
      return { text: 'NO VIDEO — stopped recovering', tone: 'caution' };
    case 'idle':
      // Publishing with no frame yet is not LIVE, but it is not off air either.
      return { text: sample.streaming ? 'waiting for video' : 'not publishing', tone: 'plain' };
    default:
      // The bridge does not honour TypeScript: a native build without the field must not read as LIVE.
      return { text: 'video state unknown', tone: 'caution' };
  }
}
