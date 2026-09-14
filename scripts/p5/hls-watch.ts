/**
 *   node scripts/p5/hls-watch.ts <manifestUrl> [intervalMs] [segmentSeconds] | tee .p5/<run>.hls.csv
 *
 * One CSV line per poll: iso,masterStatus,variant,head,targetDuration,endList,verdict,stallAfterMs
 *
 * Every input a verdict is derived from sits on the same row, because a verdict
 * whose inputs were not recorded cannot be audited. Run A took 17.2 s to call a
 * stall and its target duration was never written down; a target duration that
 * had grown the way F-P5-4's did would explain it, but nothing can now show that.
 * `stallAfterMs` is the threshold in force; `targetDuration` stays because the
 * platform changes it mid-session and that is worth seeing even though the
 * threshold no longer depends on it.
 *
 * `segmentSeconds` defaults to 2, the engine's GOP. Point the watcher at an
 * encode with a different GOP and it must be passed, or stalls are judged
 * against the wrong segment length.
 */
import { type WatchState, head, initialWatch, parseVariant, stallThresholdMs, step, variantUris } from './playlist.ts';

/** U1-S6: a non-browser User-Agent gets `403 error code: 1010` on a healthy manifest. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  return { status: response.status, text: response.status === 200 ? await response.text() : '' };
}

async function watch(masterUrl: string, intervalMs: number, stallAfterMs: number): Promise<void> {
  // The stall clock starts at 0, not at launch: `step` plants it on the first
  // variant it sees, so a stream that takes its time going live is not called
  // stalled for it.
  let state: WatchState = initialWatch;
  console.log('iso,masterStatus,variant,head,targetDuration,endList,verdict,stallAfterMs');
  for (;;) {
    const master = await get(masterUrl).catch(() => ({ status: 0, text: '' }));
    const uri = variantUris(master.text, masterUrl)[0] ?? null;
    const line = [new Date().toISOString(), master.status, uri ?? '', '', '', '', '', stallAfterMs];
    if (uri !== null) {
      const variant = await get(uri).catch(() => ({ status: 0, text: '' }));
      const next = parseVariant(variant.text);
      const polled = step(state, uri, next, Date.now(), stallAfterMs);
      state = polled.state;
      line[3] = head(next);
      line[4] = next.targetDuration;
      line[5] = String(next.endList);
      line[6] = polled.verdict;
    }
    console.log(line.join(','));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const [url, interval, segment] = process.argv.slice(2);
const segmentSeconds = Number(segment ?? 2);
if (url === undefined || !(segmentSeconds > 0)) {
  console.error('usage: hls-watch.ts <manifestUrl> [intervalMs] [segmentSeconds]');
  process.exit(1);
}
void watch(url, Number(interval ?? 2000), stallThresholdMs(segmentSeconds));
