#!/usr/bin/env node
// A thin uplink for one UDP flow, in user space: the phone's SRT goes phone -> here -> an SRT listener on
// this laptop, capped at a set rate with a short drop-tail queue, the way a congested cellular uplink
// behaves. Replies go back uncapped, as a downlink would.
//
//   node udp-throttle.mjs <listenPort> <targetPort> <kbps> [queueMs=300]
//
// Why not dummynet: on 2026-09-28 a pf `dummynet in` cap on the SRT port broke the handshake outright. The
// listener logged "Accepted", but the phone's connect failed at 3 s, while the same connect uncapped
// published in 208 ms. A cap that breaks the connect tests nothing.
//
// Prints one CSV line a second to stdout: epochMs, bytes in, bytes forwarded, packets dropped, queue ms.
import dgram from "node:dgram";

const [listenPort, targetPort, kbps, queueMsArg] = process.argv.slice(2).map(Number);
if (!listenPort || !targetPort || !kbps) {
  console.error("usage: udp-throttle.mjs <listenPort> <targetPort> <kbps> [queueMs=300]");
  process.exit(2);
}
const queueMs = queueMsArg || 300;
const bytesPerMs = (kbps * 1000) / 8 / 1000;

const outside = dgram.createSocket("udp4"); // faces the phone
const inside = dgram.createSocket("udp4"); // faces the local listener
let peer = null; // the phone's address and port, learned from its first packet
let linkFreeAt = 0; // when the modelled link finishes sending what is already queued
const tick = { in: 0, out: 0, dropped: 0 };

outside.on("message", (msg, rinfo) => {
  peer = { address: rinfo.address, port: rinfo.port };
  tick.in += msg.length;
  const now = performance.now();
  const start = Math.max(now, linkFreeAt);
  if (start - now > queueMs) {
    tick.dropped += 1; // the queue is full: a thin link loses the packet
    return;
  }
  linkFreeAt = start + msg.length / bytesPerMs;
  setTimeout(() => {
    inside.send(msg, targetPort, "127.0.0.1");
    tick.out += msg.length;
  }, linkFreeAt - now);
});
inside.on("message", (msg) => {
  if (peer) outside.send(msg, peer.port, peer.address);
});

outside.bind(listenPort, "0.0.0.0");
inside.bind(0, "127.0.0.1");
console.log("epochMs,bytesIn,bytesOut,dropped,queueMs");
setInterval(() => {
  const queued = Math.max(0, linkFreeAt - performance.now());
  console.log(`${Date.now()},${tick.in},${tick.out},${tick.dropped},${Math.round(queued)}`);
  tick.in = 0;
  tick.out = 0;
  tick.dropped = 0;
}, 1000);
