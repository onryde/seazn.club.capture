import { describe, expect, it } from 'vitest';
import { liveLine } from './liveLine';
import type { VideoState } from './P5SpikeModule';

type Case = {
  readonly videoState: VideoState;
  readonly streaming: boolean;
  readonly videoFps?: number | null;
  readonly cameraContended?: boolean;
  readonly micSilenced?: boolean;
};

/** The streaming flag stayed true through F-P5-6's eleven minutes without a picture. */
const line = ({ videoState, streaming, videoFps = null, cameraContended = false, micSilenced = false }: Case) =>
  liveLine({ videoState, streaming, transport: 'srt', videoFps, cameraContended, micSilenced });

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
    const unknown = line({ videoState: undefined as unknown as VideoState, streaming: true });
    expect(unknown.text).not.toContain('LIVE');
    expect(unknown.tone).toBe('caution');
  });

  it('covers every video state native can send', () => {
    const states: readonly VideoState[] = ['ok', 'starved', 'stalled', 'recovering', 'failed', 'idle'];
    const live = states.filter((videoState) => line({ videoState, streaming: true }).text.startsWith('LIVE'));
    expect(live).toEqual(['ok']);
  });
});

describe('liveLine — interruptions while live (F-P5-8, F-P5-9), first match wins', () => {
  it('1. a stall outranks everything the interruption rows would say', () => {
    const worst = { streaming: true, videoFps: 0, cameraContended: true, micSilenced: true };
    expect(line({ videoState: 'stalled', ...worst })).toEqual({ text: 'NO VIDEO — recovering', tone: 'caution' });
    expect(line({ videoState: 'recovering', ...worst })).toEqual({ text: 'NO VIDEO — recovering', tone: 'caution' });
  });

  it('2. stopped recovering outranks them too', () => {
    expect(line({ videoState: 'failed', streaming: true, cameraContended: true, micSilenced: true })).toEqual({
      text: 'NO VIDEO — stopped recovering',
      tone: 'caution',
    });
  });

  it('3. starved quotes the fps native judged, and outranks a silenced mic', () => {
    expect(line({ videoState: 'starved', streaming: true, videoFps: 4.3, micSilenced: true })).toEqual({
      text: 'LOW VIDEO 4.3 fps',
      tone: 'caution',
    });
  });

  it('3. starved names the other app when native saw a camera taken', () => {
    expect(line({ videoState: 'starved', streaming: true, videoFps: 8, cameraContended: true })).toEqual({
      text: 'LOW VIDEO 8.0 fps — camera in use by another app',
      tone: 'caution',
    });
  });

  it('3. starved before a full window after a reconnect has no fps to quote, and invents none', () => {
    expect(line({ videoState: 'starved', streaming: true, videoFps: null })).toEqual({
      text: 'LOW VIDEO',
      tone: 'caution',
    });
  });

  it('4. ok with the mic silenced by the system is LIVE, in caution, saying so', () => {
    expect(line({ videoState: 'ok', streaming: true, videoFps: 30, micSilenced: true })).toEqual({
      text: 'LIVE srt — MIC SILENCED BY SYSTEM',
      tone: 'caution',
    });
  });

  it('5. ok is plain LIVE, even with another camera taken, which is only evidence', () => {
    expect(line({ videoState: 'ok', streaming: true, videoFps: 30, cameraContended: true })).toEqual({
      text: 'LIVE srt',
      tone: 'plain',
    });
  });

  it('6. idle ignores a silenced mic: nothing is on air to be silent', () => {
    expect(line({ videoState: 'idle', streaming: false, micSilenced: true })).toEqual({
      text: 'not publishing',
      tone: 'plain',
    });
  });
});
