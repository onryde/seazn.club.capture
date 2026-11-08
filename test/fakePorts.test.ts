import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_DAY, FAKE_OPEN_URL } from '@/services/fakeMatchDayPort';
import { TABLE_TENNIS_SINGLES_SEED } from '@/services/fakeTableTennisPad';
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

describe('fake Match Day', () => {
  const CODE = { origin: 'https://stg.seazn.club', token: 'md_made-up' };

  it('answers the made-up day by default, lists each call, and review and approve are offline', async () => {
    const { matchDay } = createFakePorts();
    const day = await matchDay.day(CODE);
    expect(day.ok && day.value).toBe(FAKE_DAY);
    expect(await matchDay.open(CODE, 'f1')).toEqual({
      ok: true,
      value: { kind: 'link', url: FAKE_OPEN_URL, sportKey: 'badminton' },
    });
    expect(await matchDay.review(CODE, 'swiss', 's1')).toEqual({ ok: false, offline: true });
    expect(await matchDay.approve(CODE, 'swiss', 's1', 'h', 4)).toEqual({
      ok: false,
      offline: true,
    });
    expect(matchDay.calls.map((call) => call.op)).toEqual(['day', 'open', 'review', 'approve']);
    expect(matchDay.calls[1]).toEqual({ op: 'open', code: CODE, fixtureId: 'f1' });
  });

  it('a held call answers what stands at release', async () => {
    const { matchDay } = createFakePorts();
    matchDay.hold();
    const pending = matchDay.day(CODE);
    matchDay.answerDay({ ok: false, refusal: 'MD_ENDED' });
    matchDay.release();
    expect(await pending).toEqual({ ok: false, refusal: 'MD_ENDED' });
  });

  it('the store is the real one over the ports’ key-value store', async () => {
    const { ports, kv } = createFakePorts();
    await ports.matchDayStore.addOpened('f1');
    expect(kv.entries.get('matchday.opened')).toBe('["f1"]');
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

describe('fake scoring server', () => {
  const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

  it('is the preview’s badminton singles match unless a seed is given', async () => {
    const { scoring } = createFakePorts();
    await expect(scoring.bootstrap(LINK)).resolves.toMatchObject({
      kind: 'ok',
      bootstrap: { fixtureId: 'fake-singles', sportKey: 'badminton' },
    });
  });

  it('serves the seed it is given, a table tennis match, its events stamped by the phone’s clock', async () => {
    const at = new Date('2026-11-04T09:30:00.000Z');
    const { scoring } = createFakePorts({
      scoringSeed: TABLE_TENNIS_SINGLES_SEED,
      clock: () => at,
    });
    await expect(scoring.bootstrap(LINK)).resolves.toMatchObject({
      kind: 'ok',
      bootstrap: { fixtureId: 'fake-tt-singles', sportKey: 'tabletennis' },
    });
    await scoring.append(LINK, 'fake-tt-singles', {
      expected_seq: 0,
      type: 'core.start',
      payload: {},
      idempotency_key: 'k-1',
      engine_epoch: 2,
      rules_version: 0,
    });
    const events = await scoring.events(LINK, 'fake-tt-singles', 0);
    expect(Array.isArray(events) && events.map((event) => event.recordedAt)).toEqual([
      '2026-11-04T09:30:00.000Z',
    ]);
  });

  it('an explicit scoring port still wins over the seed', () => {
    const own = createFakePorts().scoring;
    const { ports } = createFakePorts({ scoring: own, scoringSeed: TABLE_TENNIS_SINGLES_SEED });
    expect(ports.scoring).toBe(own);
  });
});

describe('fake server clock', () => {
  it('offsetMs is 0 until setOffset, then what was set; a sample does not move it', () => {
    const { serverClock, ports } = createFakePorts();
    expect(ports.serverClock).toBe(serverClock);
    expect(serverClock.offsetMs()).toBe(0);
    serverClock.setOffset(300_000);
    expect(serverClock.offsetMs()).toBe(300_000);
    serverClock.sample(-5_000);
    expect(serverClock.offsetMs()).toBe(300_000);
    serverClock.setOffset(-2_500);
    expect(serverClock.offsetMs()).toBe(-2_500);
  });

  it('a subscriber hears setOffset change it, until it unsubscribes', () => {
    const { serverClock } = createFakePorts();
    let heard = 0;
    const leave = serverClock.subscribe(() => {
      heard += 1;
    });
    serverClock.setOffset(1_000);
    expect(heard).toBe(1);
    serverClock.setOffset(1_000); // no change, nothing to hear
    expect(heard).toBe(1);
    leave();
    serverClock.setOffset(2_000);
    expect(heard).toBe(1);
  });
});
