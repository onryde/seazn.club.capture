/**
 * The three things the app does. Only one runs at a time, and each is
 * unlocked by its own code — there is no login (decision record, ruling 2).
 */
export type Mode = 'stream' | 'scoring' | 'dashboard';

/**
 * A code the app recognised and can act on. The wire shape stops here: `raw`
 * is kept whole for the mode that will parse it properly (S1's credential
 * parser, S2's scoring client), and nothing else reads it.
 *
 * `raw` for a stream code carries the SRT passphrase and RTMPS key. Never log
 * it, print it, or put it in a test snapshot.
 */
export type ModeCode =
  | {
      readonly mode: 'stream';
      readonly raw: string;
      readonly sid: string;
      readonly slot: number;
      /** The descriptor's Bearer (spec decision 4). A secret: never log it. */
      readonly token: string;
      readonly expiresAt: Date;
    }
  | { readonly mode: 'scoring'; readonly raw: string; readonly token: string };

/**
 * What a scan turned out to be. A closed union, so every screen that shows a
 * result handles every outcome — the operator never meets "Invalid code".
 */
export type Recognition =
  | { readonly outcome: 'code'; readonly code: ModeCode }
  | { readonly outcome: 'expired'; readonly mode: Mode; readonly at: Date }
  | { readonly outcome: 'newerVersion'; readonly mode: Mode }
  | { readonly outcome: 'seaznPage' }
  | { readonly outcome: 'foreign' };
