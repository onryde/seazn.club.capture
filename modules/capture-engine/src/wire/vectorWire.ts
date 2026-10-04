import vectors from './snapshot-vectors.json';

const over = (base: object, patch: object | null | undefined): object | null =>
  patch === null || patch === undefined ? null : { ...base, ...patch };

/** A snapshot wire as native sends it. */
export type VectorWire = Record<string, unknown> & {
  readonly reportedAtMs: number;
  readonly telemetry: object;
  readonly pairing: object | null;
  readonly broadcast: object | null;
};

/**
 * A case's wire as native sends it: its overrides on the shared bases (the file's `about`).
 * Throws on an unknown name, so a renamed case reds rather than reading as nothing.
 */
export function vectorWire(name: string): VectorWire {
  const found = vectors.cases.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no vector case ${name}`);
  return {
    ...found.wire,
    telemetry: { ...vectors.telemetryBase, ...found.wire.telemetry },
    pairing: over(vectors.pairingBase, found.wire.pairing),
    broadcast: over(vectors.broadcastBase, found.wire.broadcast),
  };
}
