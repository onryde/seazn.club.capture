import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePorts, disposeFakePorts } from './fakePorts';
import { FAKE_SCORING_SECRET, FAKE_SCORING_URL } from './fakeScoringLinkPort';

// This runs in the node project, which has no UI setup file to dispose for it.
afterEach(() => {
  disposeFakePorts();
});

describe('fake back', () => {
  it('ignores a second unsubscribe instead of removing another handler', () => {
    const { back } = createFakePorts();
    const pressed: string[] = [];
    back.subscribe(() => {
      pressed.push('first');
      return true;
    });
    const leaveSecond = back.subscribe(() => false);
    leaveSecond();
    leaveSecond();
    expect(back.press()).toBe(true);
    expect(pressed).toEqual(['first']);
  });
});

describe('fake scoring link', () => {
  it('counts each request, and answers a link by default', async () => {
    const { scoringLink } = createFakePorts();
    await expect(scoringLink.request()).resolves.toEqual({
      kind: 'ok',
      url: FAKE_SCORING_URL,
    });
    await scoringLink.request();
    expect(scoringLink.calls).toBe(2);
  });

  it('a held request stays pending until release; two held ones release oldest first', async () => {
    const { scoringLink } = createFakePorts();
    const settled: string[] = [];
    scoringLink.hold();
    const first = scoringLink.request().then(() => settled.push('first'));
    scoringLink.hold();
    const second = scoringLink.request().then(() => settled.push('second'));
    await Promise.resolve();
    expect(settled).toEqual([]);
    scoringLink.release();
    await first;
    expect(settled).toEqual(['first']);
    scoringLink.release();
    await second;
    expect(settled).toEqual(['first', 'second']);
    expect(scoringLink.calls).toBe(2);
  });

  it('release(outcome) resolves with that outcome, and a plain release with the current answer', async () => {
    const { scoringLink } = createFakePorts();
    const refused = { kind: 'refused', word: 'replaced', retryAfterS: null } as const;
    scoringLink.hold();
    const explicit = scoringLink.request();
    scoringLink.release(refused);
    await expect(explicit).resolves.toEqual(refused);
    scoringLink.answerWith({ kind: 'refused', word: 'not_entitled', retryAfterS: null });
    scoringLink.hold();
    const plain = scoringLink.request();
    scoringLink.release();
    await expect(plain).resolves.toEqual({
      kind: 'refused',
      word: 'not_entitled',
      retryAfterS: null,
    });
  });

  it('is on the ports the screens read, the same object as the fake', () => {
    const fakes = createFakePorts();
    expect(fakes.ports.scoringLink).toBe(fakes.scoringLink);
  });
});

describe('fake scoring', () => {
  const link = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

  it('is on the ports the screens read, the same object as the fake', () => {
    const fakes = createFakePorts();
    expect(fakes.ports.scoring).toBe(fakes.scoring);
  });

  it('serves the preview’s singles match, and every createFakePorts has a ledger of its own', async () => {
    const one = createFakePorts();
    const two = createFakePorts();
    const answer = await one.scoring.bootstrap(link);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: { sides: { home: { name: 'A. Sharma' }, away: { name: 'L. Chen' } }, lastSeq: 0 },
    });
    const fixture = answer.kind === 'ok' ? answer.bootstrap.fixtureId : '';
    one.scoring.addOtherScorerEvent('core.start', {});
    expect(await one.scoring.events(link, fixture, 0)).toHaveLength(1);
    expect(await two.scoring.events(link, fixture, 0)).toEqual([]);
  });
});

describe('fake tap queue', () => {
  const queue = {
    fixtureId: 'fixture-1',
    label: 'Match 4',
    pending: [],
    ownEventIds: ['ev-1'],
    dead: null,
  } as const;

  it('is on the ports the screens read, the same object as the fake', () => {
    const fakes = createFakePorts();
    expect(fakes.ports.tapQueue).toBe(fakes.tapQueue);
  });

  it('keeps a queue, and every createFakePorts has a folder of its own', async () => {
    const one = createFakePorts();
    const two = createFakePorts();
    await one.tapQueue.save(queue);
    expect(await one.tapQueue.load('fixture-1')).toEqual(queue);
    expect(await two.tapQueue.load('fixture-1')).toBeNull();
    expect([...one.queueFiles.files.keys()]).toEqual(['fixture-1.json']);
  });
});

describe('fake realtime', () => {
  const grant = {
    token: 'fake-realtime-token',
    channel: 'fixture:fixture-1',
    url: 'https://fake.supabase.example',
    apikey: 'fake-anon-key',
  };

  it('is on the ports the screens read, the same object as the fake', () => {
    const fakes = createFakePorts();
    expect(fakes.ports.realtime).toBe(fakes.realtime);
  });

  it('is the one the test drives, and every createFakePorts has a channel of its own', () => {
    const one = createFakePorts();
    const two = createFakePorts();
    const heard = { onPing: vi.fn(), onDown: vi.fn(), onUp: vi.fn() };
    one.ports.realtime.subscribe(grant, heard);
    two.realtime.ping();
    expect(heard.onPing).not.toHaveBeenCalled();
    one.realtime.ping();
    expect(heard.onPing).toHaveBeenCalledTimes(1);
    expect(two.realtime.subscriptions).toEqual([]);
  });
});

describe('fake screen', () => {
  it('records the screen port’s calls, and whether it is dimmed', () => {
    const fakes = createFakePorts();
    expect(fakes.screen.dimmed).toBe(false);
    fakes.screen.dim();
    expect(fakes.screen.dimmed).toBe(true);
    fakes.screen.restore();
    expect(fakes.screen.calls).toEqual(['dim', 'restore']);
    expect(fakes.screen.dimmed).toBe(false);
    expect(fakes.ports.screen).toBe(fakes.screen);
  });
});

describe('fake foreground', () => {
  it('is in the foreground at first, and reports the last leave or fire, with nobody listening', () => {
    const fakes = createFakePorts();
    expect(fakes.foreground.isForeground()).toBe(true);
    fakes.foreground.leave();
    expect(fakes.foreground.isForeground()).toBe(false);
    fakes.foreground.leave();
    expect(fakes.foreground.isForeground()).toBe(false);
    fakes.foreground.fire();
    expect(fakes.foreground.isForeground()).toBe(true);
    expect(fakes.ports.foreground).toBe(fakes.foreground);
  });
});
