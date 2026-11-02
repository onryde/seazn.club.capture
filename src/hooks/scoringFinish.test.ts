import { describe, expect, it } from 'vitest';
import { readFinish } from '@/hooks/scoringFinish';
import { DECIDED_MATCH, GAME_ONE_21_15 } from '../../test/badmintonLedger';
import { createFakePorts } from '../../test/fakePorts';
import {
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  leave,
  leaveHistory,
  linkKey,
  queueHolding,
} from '../../test/scoringHomeFixtures';

// Home's cold read of "is the saved match over?" (owner ruling 41, 2026-11-02), from the phone's own files with no
// runner: the link names the sport, and the ledger, the bootstrap and the queue are what the pad folds. Anything the
// files cannot say is null, which Home reads as Continue: never a guess.

const LINE = '21–15, 21–18';

async function decidedOnDisk(fakes = createFakePorts()) {
  await leave(fakes, queueHolding(FAKE_MATCH, 0));
  await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
  return fakes;
}

describe('readFinish', () => {
  it('reads a decided match from its files: the score, in the sport’s own line', async () => {
    const fakes = await decidedOnDisk();
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toEqual({ score: LINE });
  });

  it('reads a match finalized by the organiser with the games it had', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15, { status: 'finalized' });
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toEqual({ score: '21–15' });
  });

  it('is null for a match still in play', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('needs no queue file: a match another scorer finished may never have had a tap of this phone’s', async () => {
    const fakes = createFakePorts();
    await fakes.kv.set(linkKey(FAKE_MATCH), STORED_LINK);
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toEqual({ score: LINE });
  });

  it('is null with no bootstrap cached: a match scanned and never opened cannot be known to be over', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await fakes.tapQueue.saveLedger(FAKE_MATCH, []);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null with nothing cached at all', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null with no link kept: the sport is the link’s, so a match with none is not known', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0), null);
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null for a link to another host, which reads as no link', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0), { ...LINK, origin: 'https://evil.example' });
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null when the link belongs to another host than this build’s', async () => {
    const fakes = await decidedOnDisk(createFakePorts({ hosts: ['prod.example'] }));
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('reads a finalize the queue file kept, though the cached bootstrap is from before it', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0, { dead: 'finalized' }));
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toEqual({ score: '21–15' });
  });

  it('is null for a sport this build does not score, whatever the files say', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await fakes.kv.set(linkKey(FAKE_MATCH), JSON.stringify({ ...LINK, sportKey: 'curling' }));
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null when the secure store does not answer: that says nothing of the match', async () => {
    const fakes = await decidedOnDisk();
    const locked = {
      get: () => Promise.reject(new Error('keystore locked')),
      set: () => Promise.reject(new Error('keystore locked')),
      delete: () => Promise.reject(new Error('keystore locked')),
    };
    await expect(readFinish({ ...fakes.ports, kv: locked }, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null when the ledger cannot be read: the match is not known to be over', async () => {
    const fakes = await decidedOnDisk();
    fakes.queueFiles.files.set(`${FAKE_MATCH}.ledger.json`, '{ not json');
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });

  it('is null when the cached bootstrap cannot be read', async () => {
    const fakes = await decidedOnDisk();
    fakes.queueFiles.files.set(`${FAKE_MATCH}.boot.json`, '{ not json');
    await expect(readFinish(fakes.ports, FAKE_MATCH)).resolves.toBeNull();
  });
});
