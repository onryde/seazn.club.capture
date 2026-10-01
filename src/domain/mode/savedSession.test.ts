import { describe, expect, it } from 'vitest';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_NOW } from '../../../test/fixtures/wire';

/** The staging build's one host (seaznHosts), which the fixtures' URLs sit on. */
const HOST = 'stg.seazn.club';

describe('sessionFromSaved', () => {
  it('builds the session arm needs', () => {
    const result = sessionFromSaved(savedStreamCode(), HOST);
    expect(result).toMatchObject({
      ok: true,
      value: {
        slot: 1,
        primary: { transport: 'srt' },
        fallback: { transport: 'rtmps' },
        token: 'fake-token-00000000000000000000',
        descriptor: {
          label: 'Seazn XI v Fake CC',
          overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
        },
      },
    });
  });

  it('says when the saved raw no longer parses', () => {
    expect(sessionFromSaved(savedStreamCode({ raw: '{"fake":true}' }), HOST)).toEqual({
      ok: false,
      error: 'unreadable-code',
    });
    expect(sessionFromSaved(savedStreamCode({ raw: 'not json' }), HOST)).toEqual({
      ok: false,
      error: 'unreadable-code',
    });
  });

  it('says when there is no descriptor', () => {
    expect(sessionFromSaved(savedStreamCode({ descriptor: null }), HOST)).toEqual({
      ok: false,
      error: 'no-descriptor',
    });
  });
});

/** Ruling 6, again at the arm (carry 7): what was saved is not trusted for being saved. */
describe('sessionFromSaved: the build’s one host', () => {
  const heartbeatOn = (origin: string) =>
    savedStreamCode({
      descriptor: sampleDescriptor(FIXTURE_NOW, {
        heartbeatUrl: `${origin}/api/capture/sessions/fake/heartbeat`,
      }),
    });

  it('refuses a heartbeat on the other environment’s host: it carries the Bearer', () => {
    expect(sessionFromSaved(heartbeatOn('https://seazn.club'), HOST)).toEqual({
      ok: false,
      error: 'foreign-heartbeat',
    });
  });

  it('refuses everything when the build trusts no host', () => {
    expect(sessionFromSaved(savedStreamCode(), '')).toEqual({
      ok: false,
      error: 'foreign-heartbeat',
    });
  });

  it('keeps the session but drops an overlay on another host', () => {
    const saved = savedStreamCode({
      descriptor: sampleDescriptor(FIXTURE_NOW, {
        overlayUrl: 'https://seazn.club/overlay/fixtures/fake-fixture',
      }),
    });
    const result = sessionFromSaved(saved, HOST);
    expect(result.ok && result.value.descriptor.overlayUrl).toBeNull();
    expect(result.ok && result.value.descriptor.heartbeatUrl).toBe(
      'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    );
  });

  it('reads the saved raw before the host: an unreadable code says so first', () => {
    const saved = savedStreamCode({
      raw: 'not json',
      descriptor: sampleDescriptor(FIXTURE_NOW, {
        heartbeatUrl: 'https://seazn.club/api/capture/sessions/fake/heartbeat',
      }),
    });
    expect(sessionFromSaved(saved, HOST)).toEqual({ ok: false, error: 'unreadable-code' });
  });
});
