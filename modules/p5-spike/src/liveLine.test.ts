import { describe, expect, it } from 'vitest';
import { liveLine } from './liveLine';
import type { VideoState } from './P5SpikeModule';

type Case = { readonly videoState: VideoState; readonly streaming: boolean };

/** The streaming flag stayed true through F-P5-6's eleven minutes without a picture. */
const line = ({ videoState, streaming }: Case) => liveLine({ videoState, streaming, transport: 'srt' });

describe('liveLine — LIVE only while video frames are advancing (F-P5-6)', () => {
  it('says LIVE and the transport when native reports video ok', () => {
    expect(line({ videoState: 'ok', streaming: true })).toEqual({ text: 'LIVE srt', tone: 'plain' });
  });

  it('never says LIVE over a stall, even with the streaming flag up', () => {
    expect(line({ videoState: 'stalled', streaming: true })).toEqual({ text: 'NO VIDEO — recovering', tone: 'caution' });
  });

  it('keeps saying recovering through the reconnect a recovery makes', () => {
    expect(line({ videoState: 'recovering', streaming: true })).toEqual({ text: 'NO VIDEO — recovering', tone: 'caution' });
    expect(line({ videoState: 'recovering', streaming: false })).toEqual({ text: 'NO VIDEO — recovering', tone: 'caution' });
  });

  it('says when native has stopped recovering, in caution and not in red', () => {
    expect(line({ videoState: 'failed', streaming: true })).toEqual({
      text: 'NO VIDEO — stopped recovering',
      tone: 'caution',
    });
  });

  it('says not publishing when idle and off air', () => {
    expect(line({ videoState: 'idle', streaming: false })).toEqual({ text: 'not publishing', tone: 'plain' });
  });

  it('does not claim LIVE before the first frame of a publish has arrived', () => {
    expect(line({ videoState: 'idle', streaming: true })).toEqual({ text: 'waiting for video', tone: 'plain' });
  });

  it('never says LIVE for a state it does not know — the bridge does not honour TypeScript', () => {
    const unknown = liveLine({ videoState: undefined as unknown as VideoState, streaming: true, transport: 'srt' });
    expect(unknown.text).not.toContain('LIVE');
    expect(unknown.tone).toBe('caution');
  });

  it('covers every video state native can send', () => {
    const states: readonly VideoState[] = ['ok', 'stalled', 'recovering', 'failed', 'idle'];
    const live = states.filter((videoState) => line({ videoState, streaming: true }).text.startsWith('LIVE'));
    expect(live).toEqual(['ok']);
  });
});
