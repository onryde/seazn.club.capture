import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for expo-file-system 57.0.7's `File`, `Directory` and `Paths`, written from its installed declarations
 * (build/File.d.ts, Directory.d.ts): a path-keyed map. What it cannot say is what the platform does (an atomic rename,
 * a write that survives a kill): those are device-only claims, settled on a phone.
 */
const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  calls: [] as string[],
  fail: new Set<string>(),
}));

vi.mock('expo-file-system', () => {
  type Part = string | { readonly uri: string };
  const join = (parts: readonly Part[]): string =>
    parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace('file:/', 'file:///');
  const step = (call: string): void => {
    disk.calls.push(call);
    if (disk.fail.delete(call.split(' ')[0])) throw new Error(`the disk refused ${call}`);
  };
  class File {
    readonly uri: string;
    constructor(...parts: Part[]) {
      this.uri = join(parts);
    }
    get name(): string {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists(): boolean {
      return disk.files.has(this.uri);
    }
    async text(): Promise<string> {
      step(`text ${this.name}`);
      const text = disk.files.get(this.uri);
      if (text === undefined) throw new Error('no such file');
      return text;
    }
    write(text: string): void {
      step(`write ${this.name}`);
      disk.files.set(this.uri, text);
    }
    async move(to: File, options?: { overwrite?: boolean }): Promise<void> {
      step(`move ${this.name} ${to.name} overwrite=${String(options?.overwrite)}`);
      if (disk.files.has(to.uri) && options?.overwrite !== true) throw new Error('exists');
      const text = disk.files.get(this.uri);
      if (text === undefined) throw new Error('no such file');
      disk.files.delete(this.uri);
      disk.files.set(to.uri, text);
    }
    delete(): void {
      step(`delete ${this.name}`);
      if (!disk.files.delete(this.uri)) throw new Error('no such file');
    }
  }
  class Directory {
    readonly uri: string;
    constructor(...parts: Part[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return disk.dirs.has(this.uri);
    }
    create(options?: { intermediates?: boolean; idempotent?: boolean }): void {
      step(
        `create ${this.uri} intermediates=${String(options?.intermediates)} idempotent=${String(options?.idempotent)}`,
      );
      disk.dirs.add(this.uri);
    }
    list(): (File | Directory)[] {
      step('list');
      const own = [...disk.files.keys()].filter((uri) => uri.startsWith(`${this.uri}/`));
      const sub = [...disk.dirs].filter((uri) => uri.startsWith(`${this.uri}/`));
      return [...own.map((uri) => new File(uri)), ...sub.map((uri) => new Directory(uri))];
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///data/user/0/app/files') } };
});

import { createExpoQueueFiles } from '@/services/native/expoQueueFiles';

const FOLDER = 'file:///data/user/0/app/files/scoring';

beforeEach(() => {
  disk.files.clear();
  disk.dirs.clear();
  disk.calls.length = 0;
  disk.fail.clear();
});

describe('the queue folder over expo-file-system', () => {
  it('lives in the document directory, which the system never clears, and makes itself before first use', async () => {
    const files = createExpoQueueFiles();
    expect(disk.calls).toEqual([]);
    await files.write('a.json.tmp', 'text');
    expect(disk.calls[0]).toBe(`create ${FOLDER} intermediates=true idempotent=true`);
    expect(disk.files.get(`${FOLDER}/a.json.tmp`)).toBe('text');
  });

  it('makes the folder once, not before every call', async () => {
    const files = createExpoQueueFiles();
    await files.write('a.json.tmp', 'one');
    await files.write('b.json.tmp', 'two');
    await files.names();
    expect(disk.calls.filter((call) => call.startsWith('create'))).toHaveLength(1);
  });

  it('reads a file’s text, and null for one that is not there', async () => {
    const files = createExpoQueueFiles();
    await files.write('a.json', 'hello');
    expect(await files.read('a.json')).toBe('hello');
    expect(await files.read('missing.json')).toBeNull();
  });

  it('names the files in the folder, and no sub-folder', async () => {
    const files = createExpoQueueFiles();
    await files.write('a.json', '1');
    await files.write('b.json.tmp', '2');
    disk.dirs.add(`${FOLDER}/nested`);
    expect([...(await files.names())].sort()).toEqual(['a.json', 'b.json.tmp']);
  });

  it('is empty before anything is written', async () => {
    expect(await createExpoQueueFiles().names()).toEqual([]);
  });

  it('moves a file over another, replacing it: the platform’s move with overwrite, nothing else', async () => {
    const files = createExpoQueueFiles();
    await files.write('a.json', 'old');
    await files.write('a.json.tmp', 'new');
    await files.move('a.json.tmp', 'a.json');
    expect(disk.calls).toContain('move a.json.tmp a.json overwrite=true');
    expect(disk.files.get(`${FOLDER}/a.json`)).toBe('new');
    expect(disk.files.has(`${FOLDER}/a.json.tmp`)).toBe(false);
  });

  it('removes a file, and one that is not there is not a failure', async () => {
    const files = createExpoQueueFiles();
    await files.write('a.json', '1');
    await files.remove('a.json');
    await files.remove('a.json');
    expect(disk.files.size).toBe(0);
  });

  it('lets a failure through, so the store can say so: a write the disk refuses rejects', async () => {
    const files = createExpoQueueFiles();
    disk.fail.add('write');
    await expect(files.write('a.json.tmp', 'x')).rejects.toThrow('refused');
  });

  it('lets a move the disk refuses reject, the old file whole', async () => {
    const files = createExpoQueueFiles();
    await files.write('a.json', 'old');
    await files.write('a.json.tmp', 'new');
    disk.fail.add('move');
    await expect(files.move('a.json.tmp', 'a.json')).rejects.toThrow('refused');
    expect(disk.files.get(`${FOLDER}/a.json`)).toBe('old');
  });

  it('takes a name as a name: nothing that climbs out of the folder', async () => {
    const files = createExpoQueueFiles();
    await expect(files.write('../escape.json', 'x')).rejects.toThrow();
    await expect(files.read('../escape.json')).rejects.toThrow();
    await expect(files.remove('a/b.json')).rejects.toThrow();
    expect([...disk.files.keys()]).toEqual([]);
  });
});
