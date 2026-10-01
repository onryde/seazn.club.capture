import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamSession } from '@/domain/credentials/StreamSession';
import { tokenTag } from '@/domain/credentials/tokenTag';
import type { CaptureEnginePort, EngineIntent } from '@/engine/CaptureEnginePort';
import { streamSession } from './fixtures/session';

/** One engine for one test, and how to let it go. */
export type EngineUnderTest = { readonly engine: CaptureEnginePort; dispose(): void };

/**
 * Waits until the engine has reported on the intent just sent. The fake
 * reports synchronously, so its default waits for nothing; a bridge waits for
 * native's next snapshot.
 */
export type Settle = () => Promise<void>;

const NOTHING: Settle = () => Promise.resolve();

/** Two made-up sessions of different matches: A is armed first, B tries to take its place. */
const A = streamSession();
const B = streamSession(
  { sid: '5d9c1d0e-0000-4000-8000-00000000000b', label: 'Example Town v Sample CC' },
  { sid: '5d9c1d0e-0000-4000-8000-00000000000b', slot: 2, tok: 'fake-token-b0000000000000000000' },
);

const ON_AIR: ReadonlySet<string> = new Set([
  'connecting',
  'publishing',
  'degraded',
  'reconnecting',
]);

/**
 * The engine contract (fix round 3, N1): what JS may rely on from any
 * `CaptureEnginePort`. Plan B's core sets it (SessionMachine.kt): reset only
 * from Ended, arm only from Idle, start only from Armed, and stop ends any
 * session. The session is named by its sid, slot and token tag, armed and
 * ended, and by nothing after a reset (C7, C8, N2).
 *
 * It drives the engine through the port's own intents and reads only
 * `getSnapshot()`, never a fake's test hooks, so plan C runs the same kit
 * against the bridge.
 */
export function describeEngineContract(
  name: string,
  make: () => EngineUnderTest,
  settle: Settle = NOTHING,
): void {
  describe(`the engine contract: ${name}`, () => {
    let subject: EngineUnderTest;
    beforeEach(() => {
      subject = make();
    });
    afterEach(() => subject.dispose());

    const snapshot = () => subject.engine.getSnapshot();
    const kind = () => snapshot().state.kind;
    const send = async (intent: EngineIntent) => {
      subject.engine.send(intent);
      await settle();
    };
    const arm = (session: StreamSession) =>
      send({
        kind: 'arm',
        session,
        heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
      });
    const named = () => ({
      sid: snapshot().descriptor?.sid ?? null,
      slot: snapshot().slot,
      tokenTag: snapshot().tokenTag,
    });
    const nameOf = (session: StreamSession) => ({
      sid: session.sid,
      slot: session.slot,
      tokenTag: tokenTag(session.token),
    });

    it('arms from idle, and a second arm keeps the first session', async () => {
      expect(kind()).toBe('idle');
      await arm(A);
      expect(kind()).toBe('armed');
      await arm(B);
      expect(kind()).toBe('armed');
      expect(named()).toEqual(nameOf(A));
    });

    it('arms nothing over an ended session or one on air', async () => {
      await arm(A);
      await send({ kind: 'start' });
      expect(ON_AIR.has(kind())).toBe(true);
      await arm(B);
      expect(named()).toEqual(nameOf(A));
      await send({ kind: 'stop' });
      await arm(B);
      expect(kind()).toBe('ended');
      expect(named()).toEqual(nameOf(A));
    });

    it('starts only from armed: idle and ended stay as they are', async () => {
      await send({ kind: 'start' });
      expect(kind()).toBe('idle');
      await arm(A);
      await send({ kind: 'stop' });
      await send({ kind: 'start' });
      expect(kind()).toBe('ended');
    });

    it('ends an armed session on stop, operator-stopped, still naming it', async () => {
      await arm(A);
      await send({ kind: 'stop' });
      expect(snapshot().state).toMatchObject({ kind: 'ended', reason: 'operator-stopped' });
      expect(named()).toEqual(nameOf(A));
    });

    it('ignores a reset unless ended: an armed session and one on air are left as they are', async () => {
      await arm(A);
      await send({ kind: 'reset' });
      expect(kind()).toBe('armed');
      expect(named()).toEqual(nameOf(A));
      await send({ kind: 'start' });
      await send({ kind: 'reset' });
      expect(ON_AIR.has(kind())).toBe(true);
      expect(named()).toEqual(nameOf(A));
    });

    it('resets an ended session to idle, naming nothing, and then arms the next', async () => {
      await arm(A);
      await send({ kind: 'stop' });
      await send({ kind: 'reset' });
      expect(kind()).toBe('idle');
      expect(named()).toEqual({ sid: null, slot: null, tokenTag: null });
      await arm(B);
      expect(kind()).toBe('armed');
      expect(named()).toEqual(nameOf(B));
    });
  });
}
