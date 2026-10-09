/**
 * The match label as the viewfinder's status strip shows it (spec §2, C2: D2 §4.4). The descriptor carries one joined
 * string, `"{side A} v {side B}"` or `"Match {n}"`; there are no side or partner fields, so the split is here. C2 draws
 * one size, so there is no size rule.
 */

/** Sides split on the first of these. */
export const SIDES = ' v ';
/** Partners within a side split on every one of these, and are joined by it again. */
export const PARTNERS = ' / ';

export type MatchLabel =
  | { readonly kind: 'block'; readonly text: string }
  | { readonly kind: 'sides'; readonly a: string; readonly b: string };

/** A side's names in full (C2: doubles names are not cut short), partners joined by `" / "`, an empty piece dropped. */
function side(text: string): string {
  return text
    .split(PARTNERS)
    .map((name) => name.trim())
    .filter((name) => name !== '')
    .join(PARTNERS);
}

/**
 * Split on the first `" v "`. A label with none, or with nothing on one side of it, is one block: a side is never
 * shown empty, and a block draws as one row with no bar and no v. One check for "no v" (not one per side, which
 * would each cover for the other).
 */
export function splitMatchLabel(label: string): MatchLabel {
  const block = { kind: 'block', text: label.trim() } as const;
  const at = label.indexOf(SIDES);
  if (at < 0) return block;
  const a = side(label.slice(0, at));
  const b = side(label.slice(at + SIDES.length));
  return a === '' || b === '' ? block : { kind: 'sides', a, b };
}
