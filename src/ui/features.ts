/**
 * Features that are built and tested but not shipped, one compile-time switch each. A switch changes in this file, in
 * a commit, with no env var, remote config, setting or runtime toggle: the controller's ruling of 2026-10-09,
 * implementing the owner's below. How a feature is turned on for an organiser who asks is the owner's call then.
 * A screen reads its switch as the default of a prop, so its tests can render the hidden feature without editing the
 * value here. The route passes nothing, so what ships is what this file says.
 */
export const FEATURES: { readonly viewerCheck: boolean; readonly recordSend: boolean } = {
  /**
   * What viewers see (D2 §4.3): built, and hidden by the owner's ruling of 2026-10-09 ("keep all code and just hide
   * button then when later stage like when org request we can implement"). Off, the on-air icon row is Settings, Take
   * photo and Remote scoring; nothing of the view mounts (no cell, cover, player or timers); and the heat caption does
   * not name it. On, it is D2 §4.3 as built. It is turned on when an organiser asks for it.
   */
  viewerCheck: false,
  /**
   * Send record to Seazn (B7; R3 of the D3 findings design, owner 2026-10-11): on, by the owner's ruling of 2026-10-12
   * (relayed by the controller), to the web's record contract (the D3 web brief §1). The endpoint is deployed on
   * staging; a production build answers "Can't send this record" (a 404) until production has it. Off, Stream Settings
   * shows Share record alone, and the upload credential is never stored (the D3 fixes plan's ruling P10): the
   * composition root passes this to `createNativePorts`.
   */
  recordSend: true,
};
