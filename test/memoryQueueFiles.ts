import type { QueueFiles } from '@/services/tapQueueStore';

type Op = 'names' | 'read' | 'write' | 'move' | 'moveAfterDelete' | 'remove';

export type MemoryQueueFiles = QueueFiles & {
  /** The folder as it stands: name to text. */
  readonly files: Map<string, string>;
  /** Every text any `write` was given, in order: a token in none of it is a token never written. */
  readonly written: string[];
  /** Every call, in order, as one line each: `write a.json.tmp`, `move a.json.tmp a.json`, ... */
  readonly ops: string[];
  /**
   * The next call of this kind rejects, once: a disk that fails, or an app that dies between two steps. `move`
   * fails before it does anything; `moveAfterDelete` fails after the target is deleted and before the source is
   * renamed onto it, the gap a kill leaves on Android (expo-file-system 57.0.7 `CopyMoveStrategy.kt`: the target is
   * deleted first, then renamed over).
   */
  failNext(op: Op): void;
};

/**
 * An in-memory folder for `createTapQueueStore`. Each call yields once before it acts, so two calls made without
 * awaiting really do overlap unless the store keeps them apart. `move` is NOT one step over an existing target:
 * like Android's it deletes the target and then renames, so an app killed between leaves only the source
 * (`failNext('moveAfterDelete')`).
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
      files.delete(to);
      if (failing.delete('moveAfterDelete'))
        throw new Error('the app died between the delete and the rename');
      files.delete(from);
      files.set(to, text);
    },
    remove: async (name) => {
      await step('remove', `remove ${name}`);
      files.delete(name);
    },
  };
}
