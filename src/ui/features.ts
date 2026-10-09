/**
 * Features that are built and tested but not shipped, one compile-time switch each. There is no env var, no remote
 * config, no setting and no runtime toggle: a switch changes in this file, in a commit (the owner's ruling, 2026-10-09).
 * A screen reads its switch as the default of a prop, so its tests can render the hidden feature without editing the
 * value here. The route passes nothing, so what ships is what this file says.
 */
export const FEATURES: { readonly viewerCheck: boolean } = {
  /**
   * What viewers see (D2 §4.3): built, and hidden by the owner's ruling of 2026-10-09 ("keep all code and just hide
   * button then when later stage like when org request we can implement"). Off, the on-air icon row is Settings, Take
   * photo and Remote scoring; nothing of the view mounts (no cell, cover, player or timers); and the heat caption does
   * not name it. On, it is D2 §4.3 as built. It is turned on when an organiser asks for it.
   */
  viewerCheck: false,
};
