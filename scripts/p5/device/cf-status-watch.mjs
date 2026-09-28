// Sample a live input's connection status once per interval.
//   node --env-file=.env.local cf-status-watch.mjs <inputUid> [intervalMs]
//
// Cloudflare keeps only the latest session in `status`, so a connect, a disconnect
// and a reconnect inside a minute cannot be read back afterwards: they have to be
// sampled while they happen. Prints status only, never credentials.
const [uid, interval = '1000'] = process.argv.slice(2);
if (uid === undefined) {
  console.error('usage: cf-status-watch.mjs <inputUid> [intervalMs]');
  process.exit(1);
}
const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/stream/live_inputs/${uid}`;
const headers = { Authorization: `Bearer ${process.env.CF_API_TOKEN}` };
const clean = (value) => String(value ?? '').replaceAll(',', ';');

console.log('epochMs,httpStatus,state,reason,statusEnteredAt,protocol,history');
for (;;) {
  const started = Date.now();
  try {
    const response = await fetch(url, { headers });
    const status = (await response.json()).result?.status;
    const current = status?.current;
    const history = (status?.history ?? []).map((h) => `${h.state}@${h.statusEnteredAt}`).join('|');
    console.log(
      [
        started,
        response.status,
        current?.state,
        current?.reason,
        current?.statusEnteredAt,
        current?.ingestProtocol,
        history,
      ]
        .map(clean)
        .join(','),
    );
  } catch (error) {
    console.log([started, 0, '', '', '', '', clean(error.message)].join(','));
  }
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Number(interval) - (Date.now() - started))),
  );
}
