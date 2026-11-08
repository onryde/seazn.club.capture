import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * expo-file-system 57.0.7's `File`, `Directory` and `Paths`, as small as this wiring needs: a path-keyed map, the
 * document directory where Android's `getFilesDir()` is (expo-modules-core `AppDirectoriesService`). The full stand-in
 * and the platform's own behaviour are `expoQueueFiles.test.ts`'s.
 */
const disk = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('expo-file-system', () => {
  type Part = string | { readonly uri: string };
  const join = (parts: readonly Part[]): string =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  class File {
    readonly uri: string;
    constructor(...parts: Part[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return disk.files.has(this.uri);
    }
    async text(): Promise<string> {
      return disk.files.get(this.uri) ?? '';
    }
    write(text: string): void {
      disk.files.set(this.uri, text);
    }
    async move(to: File): Promise<void> {
      disk.files.set(to.uri, disk.files.get(this.uri) ?? '');
      disk.files.delete(this.uri);
    }
    delete(): void {
      disk.files.delete(this.uri);
    }
  }
  class Directory {
    readonly uri: string;
    constructor(...parts: Part[]) {
      this.uri = join(parts);
    }
    create(): void {}
    list(): File[] {
      return [];
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///data/user/0/app/files') } };
});

import { matchDayStoreFor } from '@/hooks/matchDayStoreWiring';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';

const CODE = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };

/**
 * The inert seam (AGENTS §13, class 1): `createNativePorts` is not run by any test, so the store it wires is built by
 * this one function, tested here, and the composition root is read to call it. The controller's ruling (fix round 1):
 * the day's copy is a file in `documentDirectory/matchday`, never the secure store and never the tap queue's folder.
 */
describe('the Match Day store the composition root wires', () => {
  it('keeps the day’s copy in documentDirectory/matchday, and nothing of it in the secure store', async () => {
    const kv = createMemoryKeyValueStore();
    const logger = createLogger({ record: createRingRecord(), now: () => 0 });
    const store = matchDayStoreFor({ kv, logger });
    await store.writeCache(CODE, FAKE_DAY, new Date(0));
    expect([...disk.files.keys()]).toEqual(['file:///data/user/0/app/files/matchday/day.json']);
    expect([...kv.entries.keys()]).toEqual([]);
    expect((await store.readCache(CODE))?.day).toEqual(FAKE_DAY);
  });

  it('is the one createNativePorts gives the app, over its key-value store and logger', () => {
    const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');
    expect(source.match(/matchDayStore: [^\n]*/g)).toEqual([
      'matchDayStore: matchDayStoreFor({ kv, logger }),',
    ]);
    expect(source).not.toMatch(/createMatchDayStore/);
  });
});
