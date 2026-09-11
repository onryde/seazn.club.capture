/**
 *   node scripts/p5/hls-watch.ts <manifestUrl> [intervalMs] | tee .p5/<run>.hls.csv
 *
 * One CSV line per poll: iso,masterStatus,variant,head,verdict
 */
import { type VariantState, head, judge, parseVariant, variantUris } from './playlist.ts';

/** U1-S6: a non-browser User-Agent gets `403 error code: 1010` on a healthy manifest. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  return { status: response.status, text: response.status === 200 ? await response.text() : '' };
}

async function watch(masterUrl: string, intervalMs: number): Promise<void> {
  let previous: VariantState | null = null;
  let previousUri: string | null = null;
  let lastAdvanceMs = Date.now();
  console.log('iso,masterStatus,variant,head,verdict');
  for (;;) {
    const master = await get(masterUrl).catch(() => ({ status: 0, text: '' }));
    const uri = variantUris(master.text, masterUrl)[0] ?? null;
    const line = [new Date().toISOString(), master.status, uri ?? '', '', ''];
    if (uri !== null) {
      const variant = await get(uri).catch(() => ({ status: 0, text: '' }));
      const next = parseVariant(variant.text);
      // A new variant after a resume is a new sequence space; never compare across it.
      const judgement = judge(uri === previousUri ? previous : null, next, lastAdvanceMs, Date.now());
      lastAdvanceMs = judgement.lastAdvanceMs;
      line[3] = head(next);
      line[4] = judgement.verdict;
      previous = next;
      previousUri = uri;
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
