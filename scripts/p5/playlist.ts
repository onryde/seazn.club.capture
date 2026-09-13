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

export type Verdict = 'advancing' | 'holding' | 'stalled' | 'waiting' | 'ended';
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

/**
 * Only movement counts as health. Verified on a weak link (F-P5-2): a phone
 * whose SRT session collapsed and rebuilt 18 times in five minutes produced a
 * playlist whose head sat still for 67 of ~76 polls, and the previous version
 * of this function called every one of them `advancing` — because each
 * reconnect starts a NEW variant, the caller passed `previous = null`, and a
 * null previous was treated as progress. A run that is mostly stalled then
 * reads green, which is the failure this spike exists to catch.
 *
 * So: `advancing` requires the head to have moved within one variant, and the
 * clock that decides `stalled` is never reset by a variant change — only by
 * real progression. A first sighting is `waiting`, not health.
 */
export function judge(
  previous: VariantState | null,
  next: VariantState,
  lastAdvanceMs: number,
  nowMs: number,
): Judgement {
  // `ended` does not fire at the timeout this programme configures. Measured
  // 2026-09-12: at `recording.timeoutSeconds=180` no EXT-X-ENDLIST is ever
  // served — the master simply returns 204 at about +183 s — and that holds for
  // a clean cut and an abrupt kill alike, while 10 and 60 both emit one at
  // roughly timeout + 3 s. The branch stays because it is the correct reading of
  // a playlist that does carry ENDLIST, but nothing may treat its absence as
  // evidence a stream is still running.
  if (next.endList) return { verdict: 'ended', lastAdvanceMs };
  if (previous !== null && head(next) > head(previous)) {
    return { verdict: 'advancing', lastAdvanceMs: nowMs };
  }
  // No baseline yet: say so rather than assume the best.
  if (lastAdvanceMs === 0) return { verdict: 'waiting', lastAdvanceMs: nowMs };
  const stallAfterMs = Math.max(3 * next.targetDuration, 6) * 1000;
  if (nowMs - lastAdvanceMs > stallAfterMs) return { verdict: 'stalled', lastAdvanceMs };
  return { verdict: previous === null ? 'waiting' : 'holding', lastAdvanceMs };
}

/**
 * Identity of a variant, ignoring the query string. Cloudflare's live variant URL
 * carries per-request tokens — `lps` and `rcu` — that change on EVERY poll,
 * so comparing whole URLs makes each poll look like a brand new variant. With
 * the reconnect rule below, that reports a perfectly healthy stream as stalled.
 *
 * Caught live one minute into Run A: the head moved 1 -> 5 while the verdict
 * stayed `waiting`, because consecutive polls differed only in `lps`. The first
 * version of this fix traded a false green for a false red.
 *
 * The URL also carries `llhlsHBs`, but that is not Low-Latency HLS. What this
 * watcher pulls is STANDARD HLS: `#EXT-X-TARGETDURATION:2`, plain 2 s segments,
 * no `EXT-X-PART`. Low latency does exist on this account, but only with all three
 * of: `preferLowLatency: true` on the input (a GET omits the key until it is set),
 * the player requesting `manifest/video.m3u8?protocol=llhls` (the plain URL stays
 * standard even when the field is on), and a broadcast with no B-frames. Measured
 * 2026-09-13, RTMPS only — SRT into a low-latency input is unmeasured.
 *
 * It matters to `judge` because the stall threshold derives from the target
 * duration: 2 on the standard playlist gives 6 s, while the low-latency playlist
 * reported 3, which gives 9 s. A watcher pointed at the llhls URL changes its own
 * sensitivity without any code changing.
 */
export function variantKey(uri: string): string {
  try {
    const url = new URL(uri);
    return `${url.origin}${url.pathname}`;
  } catch {
    return uri;
  }
}

/** What the watcher carries between polls. */
export type WatchState = {
  /** A `variantKey`, never the raw URL — see above. */
  readonly key: string | null;
  readonly variant: VariantState | null;
  readonly lastAdvanceMs: number;
};

export const initialWatch: WatchState = { key: null, variant: null, lastAdvanceMs: 0 };

/**
 * One poll, as a pure step, so the reconnect storm of F-P5-2 can be driven
 * through it in a test. Heads are comparable only within a single variant, so a
 * variant change drops the baseline — but `lastAdvanceMs` crosses it untouched.
 * That carry is the whole fix: it is what makes a stream that rebuilds every
 * few seconds without ever gaining a segment read as stalled.
 */
export function step(
  state: WatchState,
  uri: string,
  next: VariantState,
  nowMs: number,
): { readonly state: WatchState; readonly verdict: Verdict } {
  const key = variantKey(uri);
  const comparable = key === state.key ? state.variant : null;
  const judgement = judge(comparable, next, state.lastAdvanceMs, nowMs);
  return {
    state: { key, variant: next, lastAdvanceMs: judgement.lastAdvanceMs },
    verdict: judgement.verdict,
  };
}
