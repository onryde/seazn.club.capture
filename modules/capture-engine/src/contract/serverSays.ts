import type { LastEnd, Refusal } from '@/domain/session/Pairing';

/**
 * What the server can say to a paired phone, as the kit scripts it: a beat's
 * answer, or a start's refusal. The fake applies one at once; the JVM host
 * (Task 27) scripts its next answer and waits for it to be heard.
 */
export type ServerSays =
  | { readonly word: 'go-live'; readonly cause: 'organiser' | 'automatic' }
  | { readonly word: 'live' }
  | { readonly word: 'over'; readonly lastEnd: LastEnd }
  | { readonly word: 'refused'; readonly refusal: Refusal }
  | { readonly word: 'replaced' }
  | { readonly word: 'taken' }
  | { readonly word: 'code-ended' };
