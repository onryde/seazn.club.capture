# Seazn Capture

The phone capture app for the Seazn streaming programme. Publishes a clean
camera feed to a Cloudflare Stream live input over SRT (RTMPS fallback). The
score overlay is composited downstream by the Fly Machine — this app never
burns graphics into the stream.

Five screens: Scan, Arm, Live, Settings, Diagnostics. Nothing else.

- **[AGENTS.md](./AGENTS.md)** — working rules. Read before writing code.
- **[_FINDINGS.md](./_FINDINGS.md)** — open findings and inherited register items.
- **[docs/specs/](./docs/specs/)** — design decisions and open questions.

## Status

Pre-implementation. The P5 device spike gates the architecture and has not
run — see the design doc's build order.

## Related

Lives alongside the main streaming programme repo, which owns the overlay
route, the session API, the compositor and the QR contract. The contract is
vendored here under `contracts/` and checked for drift in CI.
