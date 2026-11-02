import type { QueueFiles } from '@/services/tapQueueStore';

type Op = 'names' | 'read' | 'write' | 'move' | 'remove';

export type MemoryQueueFiles = QueueFiles & {
  /** The folder as it stands: name to text. */
  readonly files: Map<string, string>;
  /** Every text any `write` was given, in order: a token in none of it is a token never written. */
  readonly written: string[];
  /** Every call, in order, as one line each: `write a.json.tmp`, `move a.json.tmp a.json`, ... */
  readonly ops: string[];
  /** The next call of this kind rejects, once: a disk that fails, or an app that dies between two steps. */
  failNext(op: Op): void;
};

/**
 * An in-memory folder for `createTapQueueStore`. Each call yields once before it acts, so two calls made without
 * awaiting really do overlap unless the store keeps them apart. `move` replaces its target in one step, as the
 * platform's rename does.
 */
export function createMemoryQueueFiles(): MemoryQueueFiles {
  const files = new Map<string, string>();
  const written: string[] = [];
  const ops: string[] = [];
  const failing = new Set<Op>();
  const step = async (op: Op, line: string): Promise<void> => {
    ops.push(line);
    await Promise.resolve();
    if (failing.delete(op)) throw new Error(`the disk refused ${op}`);
  };
  return {
    files,
    written,
    ops,
    failNext: (op) => {
      failing.add(op);
    },
    names: async () => {
      await step('names', 'names');
      return [...files.keys()];
    },
    read: async (name) => {
      await step('read', `read ${name}`);
      return files.get(name) ?? null;
    },
    write: async (name, text) => {
      await step('write', `write ${name}`);
      written.push(text);
      files.set(name, text);
    },
    move: async (from, to) => {
      await step('move', `move ${from} ${to}`);
      const text = files.get(from);
      if (text === undefined) throw new Error(`no file ${from} to move`);
      files.delete(from);
      files.set(to, text);
    },
    remove: async (name) => {
      await step('remove', `remove ${name}`);
      files.delete(name);
    },
  };
}
