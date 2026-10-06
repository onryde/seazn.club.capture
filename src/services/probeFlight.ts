/**
 * Whether the dev engine probe is running (device session 4, F-S4-2). The
 * probe pairs a made-up code that no saved code owns, which the reopen gate's
 * orphan rule would unpair at the next return to the foreground, and closing
 * the permission dialog is one: the scene then read idle. The gate asks this
 * first, and leaves the probe's pairing to the probe's own clean-up.
 *
 * Dev builds only, in practice: the probe is offered nowhere else, so in a
 * release build the flag never rises. A flag, like the scan's (I2): it holds
 * nothing about the session, which native owns (AGENTS §2). Built once, in
 * the ports.
 */
export type ProbeFlight = {
  /** Raises the flag; the probe asks `active()` first, so a second run starts nothing. */
  begin(): void;
  /** The run is over, passed or failed. */
  end(): void;
  active(): boolean;
};

export function createProbeFlight(): ProbeFlight {
  let running = false;
  return {
    begin: () => {
      running = true;
    },
    end: () => {
      running = false;
    },
    active: () => running,
  };
}
