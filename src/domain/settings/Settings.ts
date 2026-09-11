/**
 * "A bit of settings" (AGENTS.md §1) — and no more. Every field here changes
 * something an operator at a ground would actually need to change.
 *
 * Pure domain: parsing stored preferences is the same anti-corruption job as
 * parsing the QR payload. Anything read back off a device is untrusted — it may
 * have been written by an older build, or corrupted — so it is validated field
 * by field and falls back to a default rather than throwing.
 */
export type ControlSide = 'left' | 'right';

export type Settings = {
  /**
   * Whether the peek button offers the score overlay while arming. Off is a
   * legitimate choice: the overlay costs thermal budget, and a club that has
   * framed once may not need it again.
   */
  readonly scorePreview: boolean;
  /**
   * Which edge the control column sits on. A right-handed operator usually has
   * their right hand on the tripod pan bar, so the column belongs under the
   * other one — but which that is depends on the person.
   */
  readonly controlSide: ControlSide;
};

export const DEFAULT_SETTINGS: Settings = {
  scorePreview: true,
  controlSide: 'right',
};

/**
 * Never throws and never returns a partial object: an unreadable preference
 * must not be able to stop an operator getting to the viewfinder.
 */
export function parseSettings(input: unknown): Settings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return DEFAULT_SETTINGS;
  }
  const record = input as Record<string, unknown>;

  return {
    scorePreview:
      typeof record.scorePreview === 'boolean'
        ? record.scorePreview
        : DEFAULT_SETTINGS.scorePreview,
    controlSide:
      record.controlSide === 'left' || record.controlSide === 'right'
        ? record.controlSide
        : DEFAULT_SETTINGS.controlSide,
  };
}
