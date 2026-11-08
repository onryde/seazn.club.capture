/**
 * One word a screen leaves for the next (S4 design §4: the Match Day list tells Home why its code went, then goes there).
 * In memory only, as `endedNotice` is: a restart builds a new one, which holds nothing. A later word replaces an earlier
 * one; the screen it is for reads it as it mounts (`peek`) and empties it (`clear`), so it is said once.
 */
export type Mailbox<T> = {
  post(word: T): void;
  /** What waits, without taking it: safe to read while rendering. */
  peek(): T | null;
  clear(): void;
};

export function createMailbox<T>(): Mailbox<T> {
  let word: T | null = null;
  return {
    post: (next) => {
      word = next;
    },
    peek: () => word,
    clear: () => {
      word = null;
    },
  };
}
