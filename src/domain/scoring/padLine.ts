/**
 * What a tap came to, and the words the last-tap line adds to the last tap's sentence (S2 owner ruling 14; plan S2-1
 * Task 9). Sport-agnostic. Words are dictionary keys, like the rest of the pad's (`padView.ts`): the domain never
 * imports the dictionaries, and the hook's `MessageKey` accepts every key named here (`padLine.test.ts` reads them
 * back from `en.json`).
 */

/** Why a tap was not taken: not at this point of the match, a score no game in progress has, nothing of the scorer's to undo. */
export type PadRefusal = 'notNow' | 'invalidScore' | 'nothingToUndo';

/** What a tap came to on the phone, at once: taken into the queue, or refused with a reason. */
export type PadOutcome =
  { readonly ok: true } | { readonly ok: false; readonly refusal: PadRefusal };

export const TAKEN: PadOutcome = { ok: true };
export const refusing = (refusal: PadRefusal): PadOutcome => ({ ok: false, refusal });

/**
 * Every key the line can say. A `refusal` takes the sentence's place (the tap did not count) and a `note` goes under
 * it, which stays (a bounced repeat counted once; another scorer's tap since: Undo is off, and nothing failed).
 */
export type PadLineKey =
  | 'scoring.refusal.notNow'
  | 'scoring.refusal.invalidScore'
  | 'scoring.refusal.nothingToUndo'
  | 'scoring.refusal.notCounted'
  | 'scoring.refusal.notSaved'
  | 'scoring.refusal.savePending'
  | 'scoring.refusal.choiceNotSaved'
  | 'scoring.pad.countedOnce'
  | 'scoring.pad.otherScorerSince'
  | 'scoring.pad.undoWaiting';

export type PadLineWords =
  | { readonly kind: 'refusal'; readonly key: PadLineKey }
  | { readonly kind: 'note'; readonly key: PadLineKey }
  | null;

/** The words a refused tap says. */
export const REFUSAL_WORDS: Readonly<Record<PadRefusal, PadLineKey>> = {
  notNow: 'scoring.refusal.notNow',
  invalidScore: 'scoring.refusal.invalidScore',
  nothingToUndo: 'scoring.refusal.nothingToUndo',
};

export const refusalLine = (key: PadLineKey): PadLineWords => ({ kind: 'refusal', key });
export const noteLine = (key: PadLineKey): PadLineWords => ({ kind: 'note', key });
