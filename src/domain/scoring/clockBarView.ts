import type { PadText } from '@/domain/scoring/padView';

/**
 * A pad's match clock, as the kit's clock bar draws it (S2-5 design §6.1): a kit part with no sport named, drawn from
 * what a sport fills in, so a second sport with a match clock takes it as it is (S2 design §5, "a clock part in the
 * kit"). The sport reads its own clock and says the face, the period and the one button; the bar decides nothing.
 * `K` is the sport's own key union, as in `PadView`.
 */
export type ClockBarView<K extends string> = {
  /** The face as the match counts it ("67:00", "90+2:30"), in tabular figures. Numbers and punctuation: never translated. */
  readonly time: string;
  /** The period under way, or the break between two ("1st half", "Half-time"); none where there is nothing to name. */
  readonly period: PadText<K> | null;
  /** What a screen reader hears for the face ("Match clock 45+1:20"): the period is read on its own line. */
  readonly said: PadText<K>;
  /** The one button: Start while the clock is stopped, Pause while it runs; none where the clock takes neither. */
  readonly action: ClockBarAction<K> | null;
};

/** The clock bar's button: what it does, and its word. */
export type ClockBarAction<K extends string> = {
  readonly kind: 'start' | 'pause';
  readonly label: PadText<K>;
};
