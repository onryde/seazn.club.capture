import { afterEach, describe, expect, it } from 'vitest';
import { createFakePorts, disposeFakePorts } from './fakePorts';
import { FAKE_SCORING_URL } from './fakeScoringLinkPort';

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
