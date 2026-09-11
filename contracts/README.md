# Contracts

Vendored copies of the published language between the **Capture** context (this
app) and the **Broadcast** context (compositor, session API, Cloudflare).

Expected here:

- `capture-qr.v1.json` — the QR contract. Source of truth lives in the main
  streaming programme repo; this is a vendored copy.
- generated types derived from it.

## Rules

- **This is a copy, not the source.** Changing it requires the CI drift check
  against the main repo's version. A phone and a server disagreeing about
  credential shape is the failure this guards.
- The wire shape never reaches the domain. `src/domain/credentials` holds the
  anti-corruption layer that parses this into `SessionCredentials`, so a v2
  contract touches one file.

## Currently blocked

The contract is mid-revision. C1 (both credential sets in hand at scan time),
C2 (`holdWindowSeconds` as a behavioural clause), M3 (the slot concept) and N2
(credential lifetime and scope) are all open against it. See `_FINDINGS.md`.

Vendor the file once those land, not before — vendoring a contract that is
about to change buys nothing.
