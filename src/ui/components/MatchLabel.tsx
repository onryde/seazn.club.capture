import { memo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { SIDES, splitMatchLabel } from '@/domain/session/matchLabel';
import { selectLabel } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { Text } from '@/ui/components/Text';
import { colour, layout } from '@/ui/theme/tokens';

/**
 * The match label, C2 (D2 §4.4): one row per side, each with a 3 dp bar at its left edge (lime for the first side,
 * lilac for the second), the names in Barlow Condensed 600, mixed case, as typed, at one size, at most 2 lines a side
 * and an ellipsis beyond. A small v in ink2 sits in a fixed left margin outside both rows, centred between them. It
 * is decorative: a screen reader reads the label once, as typed. A label with no two sides is one row, no bar, no v.
 * Nothing at all until the label is known, or when it is empty.
 *
 * `onLayoutHeight` (R-F5) tells the stage how tall the label came out, which is how the picture is sized from this
 * match (`stripReserve`): the height after each layout, and 0 when the label goes or changes, so a label that is not
 * there yet is unmeasured, never the last one's height. The newest callback is the one called, so one made anew on
 * every render is fine.
 */
export function MatchLabel({ onLayoutHeight }: { onLayoutHeight?: (height: number) => void }) {
  const label = useEngineSelector(selectLabel);
  // Keyed on its text: a label that changes in place is a new label, so the old one's height goes with it.
  return label === null || label.trim() === '' ? null : (
    <SplitLabel key={label} label={label} onLayoutHeight={onLayoutHeight} />
  );
}

function SplitLabel({
  label,
  onLayoutHeight,
}: {
  label: string;
  onLayoutHeight?: (height: number) => void;
}) {
  // The newest callback, held in a ref, so the layout handler is stable and the reset below runs only when the
  // label goes: a callback made anew each render would otherwise read as a label that went, and no layout comes
  // after it to say the height again.
  const latest = useRef(onLayoutHeight);
  useEffect(() => {
    latest.current = onLayoutHeight;
  });
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => latest.current?.(event.nativeEvent.layout.height),
    [],
  );
  useEffect(() => () => latest.current?.(0), []);
  const split = splitMatchLabel(label);
  return (
    // One accessible stop that reads the whole label as typed, not each row and the v (review M4). `accessible`
    // groups the children on native; react-native-web drops it.
    <View {...marker(split.kind)} accessible accessibilityLabel={label} onLayout={onLayout}>
      {split.kind === 'block' ? <Name text={split.text} /> : <Sides a={split.a} b={split.b} />}
    </View>
  );
}

const Sides = memo(function Sides({ a, b }: { readonly a: string; readonly b: string }) {
  return (
    <View style={styles.sides}>
      <View style={styles.margin}>
        {/* The label's own separator, the server's word: decorative, so hidden from a screen reader. */}
        <Text variant="metricUnit" style={styles.v} aria-hidden testID="match-label-v">
          {SIDES.trim()}
        </Text>
      </View>
      <View style={styles.rows}>
        <SideRow text={a} side="first" />
        <SideRow text={b} side="second" />
      </View>
    </View>
  );
});

const SideRow = memo(function SideRow({
  text,
  side,
}: {
  readonly text: string;
  readonly side: 'first' | 'second';
}) {
  return (
    <View style={styles.row}>
      <View {...barMarker(side)} style={side === 'first' ? firstBar : secondBar} />
      <Name text={text} />
    </View>
  );
});

/** One side, or the block: one size, at most 2 lines, an ellipsis beyond (C2). */
const Name = memo(function Name({ text }: { readonly text: string }) {
  return (
    <Text
      variant="label"
      numberOfLines={layout.labelSideLines}
      style={styles.name}
      testID="match-label-line"
    >
      {text}
    </Text>
  );
});

/**
 * The test markers. react-native-web renders `dataSet` as `data-*` attributes, which tests read; native ignores it.
 * React Native's own types leave `dataSet` out, hence the casts.
 */
const marker = (kind: string) => ({ testID: 'match-label', dataSet: { kind } }) as ViewProps;
const barMarker = (side: string) => ({ testID: 'match-label-bar', dataSet: { side } }) as ViewProps;

const styles = StyleSheet.create({
  sides: { flexDirection: 'row' },
  // The v's margin: fixed, outside both rows, the v centred between them.
  margin: { width: layout.labelMargin, justifyContent: 'center' },
  v: { color: colour.ink2 },
  rows: { flex: 1 },
  row: { flexDirection: 'row', gap: layout.labelBarGap },
  bar: { width: layout.labelBar },
  barFirst: { backgroundColor: colour.lime },
  barSecond: { backgroundColor: colour.ink3 },
  name: { flex: 1 },
});

const firstBar = [styles.bar, styles.barFirst];
const secondBar = [styles.bar, styles.barSecond];
