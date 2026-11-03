import type { LinkPort } from '@/services/linkPort';

export type FakeLinkPort = LinkPort & {
  /** Every URL asked for, in order, refused ones included. */
  readonly opened: readonly string[];
  /** Every later open rejects, as a phone with no browser would, until `refuse(false)`. */
  refuse(on?: boolean): void;
};

export function createFakeLinkPort(): FakeLinkPort {
  const opened: string[] = [];
  let refusing = false;
  return {
    opened,
    refuse: (on = true) => {
      refusing = on;
    },
    openUrl: async (url) => {
      opened.push(url);
      if (refusing) throw new Error('no app can open this link');
    },
  };
}
