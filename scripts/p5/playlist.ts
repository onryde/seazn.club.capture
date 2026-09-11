/**
 * Playlist reading for the P5 watcher, following the main repo's U1 method.
 *
 * Two traps it paid for: the MASTER carries no media sequence (advancement lives
 * in the VARIANT), and a resumed broadcast can come back as a NEW variant — so
 * the watcher re-resolves the master on every poll instead of pinning one.
 * And U1-S7: inside the hold window playback STALLS, no error fires. Stalls are
 * detected from the playlist not advancing, never from an error.
 */

export type VariantState = {
  readonly mediaSequence: number;
  readonly segments: number;
  readonly endList: boolean;
  readonly targetDuration: number;
};

export type Verdict = 'advancing' | 'stalled' | 'ended';
export type Judgement = { readonly verdict: Verdict; readonly lastAdvanceMs: number };

export function variantUris(master: string, masterUrl: string): readonly string[] {
  return master
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => new URL(line, masterUrl).toString());
}

export function parseVariant(text: string): VariantState {
  const lines = text.split('\n').map((line) => line.trim());
  const tag = (name: string) => lines.find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1);
  return {
    mediaSequence: Number(tag('#EXT-X-MEDIA-SEQUENCE') ?? 0),
    segments: lines.filter((line) => line.startsWith('#EXTINF')).length,
    endList: lines.includes('#EXT-X-ENDLIST'),
    targetDuration: Number(tag('#EXT-X-TARGETDURATION') ?? 0),
  };
}

/** The newest segment's position. Advances even when the window slides. */
export function head(state: VariantState): number {
  return state.mediaSequence + state.segments;
}

export function judge(
  previous: VariantState | null,
  next: VariantState,
  lastAdvanceMs: number,
  nowMs: number,
): Judgement {
  if (next.endList) return { verdict: 'ended', lastAdvanceMs };
  if (previous === null || head(next) > head(previous)) {
    return { verdict: 'advancing', lastAdvanceMs: nowMs };
  }
  const stallAfterMs = Math.max(3 * next.targetDuration, 6) * 1000;
  return { verdict: nowMs - lastAdvanceMs > stallAfterMs ? 'stalled' : 'advancing', lastAdvanceMs };
}
