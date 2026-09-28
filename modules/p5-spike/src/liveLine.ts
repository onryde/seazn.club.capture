import type { SpikeSample } from './P5SpikeModule';

export type LiveLine = { readonly text: string; readonly tone: 'plain' | 'caution' };

type LiveLineSample = Pick<
  SpikeSample,
  'streaming' | 'transport' | 'videoState' | 'videoFps' | 'cameraContended' | 'micSilenced'
>;

/**
 * The HUD's first line. F-P5-6: for eleven minutes it read `LIVE srt` while the encoder had no
 * picture, because it was keyed on the streaming flag. It now says LIVE only when native reports
 * video frames advancing (AGENTS.md §6: one status line that always says something true). Native
 * computes `videoState`; this only words it.
 *
 * The 2026-09-28 interruptions add two truths LIVE was hiding: a picture starved by another app's
 * camera (F-P5-9), and a microphone the system silenced during a phone call (F-P5-8). First match
 * wins: no picture, then a starved picture, then a silent one. All of them are caution, never red
 * (AGENTS.md §5: red means ON AIR only).
 *
 * No `wanted` is needed here: native returns to `idle` on every operator intent, so
 * `stalled`, `recovering`, `failed` and `starved` only ever exist while a publish is wanted.
 */
export function liveLine(sample: LiveLineSample): LiveLine {
  switch (sample.videoState) {
    case 'ok':
      return okLine(sample);
    case 'starved':
      return { text: starvedText(sample), tone: 'caution' };
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

/** F-P5-8: frames flowing, so it is LIVE, but a quiet mic reaches YouTube quiet (AGENTS.md §6). */
function okLine(sample: LiveLineSample): LiveLine {
  const live = `LIVE ${sample.transport ?? ''}`;
  return sample.micSilenced === true
    ? { text: `${live} — MIC SILENCED BY SYSTEM`, tone: 'caution' }
    : { text: live, tone: 'plain' };
}

/**
 * F-P5-9. The fps is the window rate native judged, so the line and the decision never disagree.
 * Before a full window after a reconnect there is none, and none is invented.
 */
function starvedText(sample: LiveLineSample): string {
  const fps = typeof sample.videoFps === 'number' ? ` ${sample.videoFps.toFixed(1)} fps` : '';
  const contended = sample.cameraContended === true ? ' — camera in use by another app' : '';
  return `LOW VIDEO${fps}${contended}`;
}
