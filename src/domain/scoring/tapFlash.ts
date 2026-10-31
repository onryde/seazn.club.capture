import type { PadSide } from '@/domain/scoring/padView';

/**
 * The last tap on a half that counted on this phone, for the half's flash (owner ruling 14, 2026-10-31: "the tapped
 * half flashes lime briefly so you see at a glance your tap counted"): its side and its number. Each counted tap takes
 * the next number, so a second one on the same half is a new flash; a tap that did not count (refused, or a bounce
 * counted once) takes none, and nor does Undo, Set score or a sanction. Null before any, and once the preview row picks
 * another state.
 */
export type HalfFlash = { readonly side: PadSide; readonly seq: number } | null;

/** A half's cue: the number of the counted tap that is its own, or 0 (the last counted tap was the other half's, or none). */
export function flashCue(flash: HalfFlash, side: PadSide): number {
  return flash !== null && flash.side === side ? flash.seq : 0;
}

/**
 * What a half's flash does when its cue moves from `seen` (the cue it last acted on, or mounted with) to `cue`: a new
 * counted tap flashes; a cue gone to 0 stops a flash still showing (the other half's tap counted, or the flash was
 * cleared); the same cue does nothing, so a re-render, a mount or a remount never flashes.
 */
export type FlashMove = 'flash' | 'stop' | 'none';

export function flashMove(seen: number, cue: number): FlashMove {
  if (cue === seen) return 'none';
  return cue === 0 ? 'stop' : 'flash';
}
