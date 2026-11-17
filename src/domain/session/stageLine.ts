/** capture-descriptor.v1 `stage.label`: 1 to 40 characters in the org's locale, shown verbatim (spec §2). */
export const STAGE_LABEL_MAX = 40;

/** Code points, as JSON Schema counts a length: a 🏏 is one character, two UTF-16 units. */
const characters = (text: string) => [...text].length;

/**
 * The round line for a stage label, or null. A missing, empty or over-40 label shows no line; one that is
 * too long is never cut, because the server omits it rather than cut it. The phone builds and translates
 * nothing: this is the server's text.
 */
export function stageLine(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const length = characters(label);
  return length >= 1 && length <= STAGE_LABEL_MAX ? label : null;
}

/**
 * The round line on a court code (court stream spec 2026-11-14 §6.2): the court's name, then the stage when the match
 * has one, joined by " · ". With no court it is the stage's own line, as before. One line; `StageLine` cuts it with an
 * ellipsis. Both parts are the server's text, never built or translated here.
 */
export function roundLine(court: string | null, stage: string | null | undefined): string | null {
  const round = stageLine(stage); // the 1–40 check stays the stage's own
  if (court === null) return round;
  return round === null ? court : `${court} · ${round}`;
}
