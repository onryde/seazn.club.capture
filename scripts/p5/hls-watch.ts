/**
 *   node scripts/p5/hls-watch.ts <manifestUrl> [intervalMs] | tee .p5/<run>.hls.csv
 *
 * One CSV line per poll: iso,masterStatus,variant,head,verdict
 */
import { type WatchState, head, initialWatch, parseVariant, step, variantUris } from './playlist.ts';

/** U1-S6: a non-browser User-Agent gets `403 error code: 1010` on a healthy manifest. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  return { status: response.status, text: response.status === 200 ? await response.text() : '' };
}

async function watch(masterUrl: string, intervalMs: number): Promise<void> {
  // The stall clock starts at 0, not at launch: `step` plants it on the first
  // variant it sees, so a stream that takes its time going live is not called
  // stalled for it.
  let state: WatchState = initialWatch;
  console.log('iso,masterStatus,variant,head,verdict');
  for (;;) {
    const master = await get(masterUrl).catch(() => ({ status: 0, text: '' }));
    const uri = variantUris(master.text, masterUrl)[0] ?? null;
    const line = [new Date().toISOString(), master.status, uri ?? '', '', ''];
    if (uri !== null) {
      const variant = await get(uri).catch(() => ({ status: 0, text: '' }));
      const next = parseVariant(variant.text);
      const polled = step(state, uri, next, Date.now());
      state = polled.state;
      line[3] = head(next);
      line[4] = polled.verdict;
    }
    console.log(line.join(','));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const [url, interval] = process.argv.slice(2);
if (url === undefined) {
  console.error('usage: hls-watch.ts <manifestUrl> [intervalMs]');
  process.exit(1);
}
void watch(url, Number(interval ?? 2000));
