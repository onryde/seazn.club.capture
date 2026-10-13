import { RECORD_SID, RECORD_WINDOW_ENDS, RECORD_WINDOW_OPENS } from '@/services/recordContract';

/**
 * N38 (the controller's ruling, 2026-10-12): Send record posts the ring's newest lines, and the web files a line with
 * no sid under a code only inside a pairing window, which opens at the pairing's `pair` line (the contract's A2).
 * About ten minutes on air fill the ring, so the `pair` line and the `broadcast-start` that names the broadcast's sid
 * had gone, and the web filed none of the 1,000 lines (R-MA1P: kept 0). So the ring pins, outside its capacity, the
 * latest `pair` line and, while its window is open, the latest `broadcast-start` with a sid A1 can judge. The contract
 * names no other kind that binds a sid: A1 judges each line by its own. A pinned line is the line the ring was given,
 * never one written here. Share record and Diagnostics show the ring alone.
 *
 * The controller's amendment to the N38 ruling (2026-10-13, Batch 18 fix round 1): Send is off air only and the token
 * outlives the pairing by 24 h (R4), so a send follows the window's end; R-MA1P went 10 s after a Stop. The web's
 * window runs through the line that ended it, so the pins stand until that line has left the ring, or until a newer
 * `pair` replaces them. While they stand, the ending line goes in the body too, in its place: without it the pins would
 * file the lines after the end under the old pairing.
 */

/** The kind that names a broadcast's sid (`Starts.arm`, Pairings.kt): pinned while its pairing's `pair` stands. */
export const START_KIND = 'broadcast-start';

/** A line the ring was given, and its place among every line it was given: 0 for the first. */
export type PinnedLine = { readonly place: number; readonly line: string };

/**
 * A start is pinned only while its pair's window is open, so it is always the later of the two. `endedAt` is the place
 * of the line that ended the window (the first of `RECORD_WINDOW_ENDS` after the pair), or null while it is open.
 */
export type RecordPins = {
  readonly pair: PinnedLine | null;
  readonly start: PinnedLine | null;
  readonly endedAt: number | null;
};

export const NO_PINS: RecordPins = { pair: null, start: null, endedAt: null };

/**
 * The pins once the ring has been given `line` at `place`. Only the line's `kind` and `sid` are read, and a line that
 * is not JSON is read as having neither: it is never pinned and moves no pin.
 */
export function pinsAfter(pins: RecordPins, line: string, place: number): RecordPins {
  const { kind, sid } = fieldsOf(line);
  if (kind === RECORD_WINDOW_OPENS) return { pair: { place, line }, start: null, endedAt: null };
  if (pins.pair === null || pins.endedAt !== null) return pins;
  // Read as a set of anything: a kind that is not text ends nothing.
  if ((RECORD_WINDOW_ENDS as ReadonlySet<unknown>).has(kind)) return { ...pins, endedAt: place };
  const names = kind === START_KIND && typeof sid === 'string' && RECORD_SID.test(sid);
  return names ? { ...pins, start: { place, line } } : pins;
}

function fieldsOf(line: string): { readonly kind?: unknown; readonly sid?: unknown } {
  try {
    // Object() reads null and every scalar as an object with no fields, so only a JSON object's own are read.
    return Object(JSON.parse(line)) as { readonly kind?: unknown; readonly sid?: unknown };
  } catch {
    return {};
  }
}

/**
 * What Send record posts, at most `max` lines: each pinned line the ring has let go of, first, then the ring's newest
 * lines. A pinned line still in the ring goes once, in its place, and so does the line that ended the pins' window; the
 * oldest lines that are neither give way, so every line goes in the order the ring was given it. Once that ending line
 * has left the ring the pins are released. `first` is the place of the ring's oldest line.
 */
export function pinnedAndNewest(
  ring: readonly string[],
  first: number,
  pins: RecordPins,
  max: number,
): readonly string[] {
  const standing = pins.endedAt === null || pins.endedAt >= first ? pins : NO_PINS;
  const pinned = [standing.pair, standing.start].filter((pin): pin is PinnedLine => pin !== null);
  const letGo = pinned.filter((pin) => pin.place < first);
  const held = new Set([...pinned.map((pin) => pin.place), standing.endedAt]);
  let over = letGo.length + ring.length - max;
  const newest = ring.filter((_, index) => {
    if (over <= 0 || held.has(first + index)) return true;
    over -= 1;
    return false;
  });
  return [...letGo.map((pin) => pin.line), ...newest];
}
