import { describe, expect, it } from 'vitest';
import { parseSessionCredentials } from '@/domain/credentials/parseSessionCredentials';
import {
  buildLiveInputRequest,
  echoMismatches,
  hlsManifestUrl,
  readCreatedInput,
  toSessionPayload,
} from './liveInput.ts';

const CREATED = {
  uid: 'abc123',
  srt: { url: 'srt://live.cloudflare.com:778', streamId: 'sid-1', passphrase: 'pass-1' },
  rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: 'key-1' },
  recording: { mode: 'automatic', timeoutSeconds: 180 },
  deleteRecordingAfterDays: 30,
};

const OPTIONS = {
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/f1',
  playbackUrl: 'https://customer-x.cloudflarestream.com/abc123/manifest/video.m3u8',
};

describe('buildLiveInputRequest', () => {
  it('asks for the ruled hold window with automatic recording and the 30-day backstop', () => {
    expect(buildLiveInputRequest('run-a')).toEqual({
      meta: { name: 'p5-spike-run-a' },
      recording: { mode: 'automatic', timeoutSeconds: 180 },
      deleteRecordingAfterDays: 30,
    });
  });
});

describe('echoMismatches', () => {
  it('is empty when Cloudflare echoes every setting back', () => {
    expect(echoMismatches(buildLiveInputRequest('r'), CREATED)).toEqual([]);
  });

  it('catches timeoutSeconds coming back null — the silent platform-default trap', () => {
    const echoed = { ...CREATED, recording: { mode: 'automatic', timeoutSeconds: null } };
    expect(echoMismatches(buildLiveInputRequest('r'), echoed)).toEqual([
      'recording.timeoutSeconds: sent 180, got null',
    ]);
  });

  it('treats a missing recording object as every recording field changed', () => {
    const { recording: _dropped, ...echoed } = CREATED;
    expect(echoMismatches(buildLiveInputRequest('r'), echoed)).toHaveLength(2);
  });
});

describe('readCreatedInput', () => {
  it('reads the uid and both credential shapes', () => {
    expect(readCreatedInput(CREATED)).toEqual({
      uid: 'abc123',
      srt: { url: 'srt://live.cloudflare.com:778', streamId: 'sid-1', passphrase: 'pass-1' },
      rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: 'key-1' },
    });
  });

  it('names the missing field rather than failing later on the phone', () => {
    expect(() => readCreatedInput({ ...CREATED, srt: { url: 'srt://x:1' } })).toThrow(
      'srt.streamId',
    );
  });
});

describe('hlsManifestUrl', () => {
  it('builds the live input manifest on the customer subdomain', () => {
    expect(hlsManifestUrl('customer-x.cloudflarestream.com', 'abc123')).toBe(
      'https://customer-x.cloudflarestream.com/abc123/manifest/video.m3u8',
    );
  });
});

describe('toSessionPayload', () => {
  it("parses through the app's own anti-corruption layer with SRT primary", () => {
    const parsed = parseSessionCredentials(toSessionPayload(readCreatedInput(CREATED), OPTIONS));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.primary.transport).toBe('srt');
    expect(parsed.value.fallback.transport).toBe('rtmps');
    expect(parsed.value.holdWindowSeconds).toBe(180);
    expect(parsed.value.overlayUrl).toBe(OPTIONS.overlayUrl);
  });

  it('can break only the SRT address, for the fallback run', () => {
    const payload = toSessionPayload(readCreatedInput(CREATED), {
      ...OPTIONS,
      srtUrlOverride: 'srt://live.cloudflare.com:1',
    });
    expect(payload.srt.url).toBe('srt://live.cloudflare.com:1');
    expect(payload.rtmps.url).toBe('rtmps://live.cloudflare.com:443/live/');
  });
});
