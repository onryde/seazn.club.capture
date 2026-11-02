import { Children, memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { SwitchTrack } from '@/ui/components/SwitchTrack';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type SettingsRowProps = {
  /** The row's name, at the left. */
  readonly label: string;
  /** What the setting is now, at the right, in ink2. */
  readonly value?: string;
  /** `caution` for a value that wants attention (a battery mode that stops a locked phone beating), never red (AGENTS §5). */
  readonly tone?: 'normal' | 'caution';
  /**
   * One short line under the label, in ink2 at small size, only where it says what to do or why the row is off. It is
   * also in the button's name, since a screen reader reads the name and not the words inside it.
   */
  readonly helper?: string | null;
  /** The row is a button: the whole row is the target, and a chevron says it goes somewhere. */
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  /** The row opens a list below it (the chevron turns down); said to a screen reader as expanded or not. */
  readonly expanded?: boolean;
  /** The row is a switch: the pill takes the chevron's place and the state is said to a screen reader. */
  readonly checked?: boolean;
  /** A control drawn at the right (the side pair). The row is then a plain container: only the control is pressed. */
  readonly right?: ReactNode;
};

/**
 * One row of the app's Settings (owner, 2026-11-02: "clean display instead of printing text"): the label at the left,
 * the value or the control at the right, 56 dp tall at least, so a row is a generous target and the rows of a group
 * are one height. No sentence rides a row; a helper is one line and only where it says what to do. A row is one of four
 * things, chosen by its props: a button (`onPress`), a switch (`checked`), a container for a control (`right`), or text.
 */
export const SettingsRow = memo(function SettingsRow({
  label,
  value,
  tone = 'normal',
  helper = null,
  onPress,
  disabled = false,
  expanded,
  checked,
  right,
}: SettingsRowProps) {
  const body = (
    <>
      <View style={styles.words}>
        <Text variant="controlInk" style={disabled ? styles.off : undefined}>
          {label}
        </Text>
        {helper === null ? null : <Text variant="controlSmall">{helper}</Text>}
      </View>
      {value === undefined ? null : (
        <Text variant="control" style={tone === 'caution' ? styles.caution : undefined}>
          {value}
        </Text>
      )}
      {right}
      {checked === undefined ? null : <SwitchTrack checked={checked} />}
      {onPress !== undefined && checked === undefined ? <Chevron open={expanded === true} /> : null}
    </>
  );
  if (onPress === undefined) return <View style={styles.row}>{body}</View>;
  const name = [label, value, helper].filter((part) => part != null).join(' · ');
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'switch'}
      accessibilityLabel={name}
      // aria-checked and aria-expanded, not accessibilityState: react-native-web drops the state object, and React
      // Native's Pressable reads these into the same state (as ChoiceRow has it).
      aria-checked={checked}
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      style={rowStyle}
    >
      {body}
    </Pressable>
  );
});

/** A chevron as text, so it takes the value's face and size; a picture of "this opens", never a control of its own. */
function Chevron({ open }: { open: boolean }) {
  return (
    <Text
      testID="row-chevron"
      aria-hidden
      variant="control"
      style={open ? styles.chevronOpen : styles.chevron}
    >
      ›
    </Text>
  );
}

/** Module-level so render allocates no function. A held row takes the press fill, and its box never moves (Batch 17). */
function rowStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedRow : styles.row;
}

/**
 * Rows in one card on the surface ground, parted by hairlines (`rule`), none above the first or below the last. A
 * child that is not there (a row that is Android's alone) leaves no line behind it.
 */
export const SettingsGroup = memo(function SettingsGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View testID="settings-group" style={styles.group}>
      {rows.flatMap((row, at) =>
        at === 0
          ? [row]
          : [<View key={`rule-${at}`} testID="settings-divider" style={styles.rule} />, row],
      )}
    </View>
  );
});

/**
 * A heading in short display caps and its group. The heading is a name, never a sentence (owner, 2026-11-02): it is in
 * `actionSecondary`, Barlow Condensed 600 in ink2, one step under the screen's own title.
 */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="actionSecondary" accessibilityRole="header">
        {title}
      </Text>
      <SettingsGroup>{children}</SettingsGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.settingsRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  pressed: { backgroundColor: colour.pressFill },
  /** The label (and its helper) take the line, so the value or control is pushed to the right and a long label wraps. */
  words: { flex: 1, gap: 2 },
  off: { color: colour.ink3 },
  caution: { color: colour.caution },
  chevron: { color: colour.ink3 },
  chevronOpen: { color: colour.ink3, transform: [{ rotate: '90deg' }] },
  group: {
    backgroundColor: colour.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  rule: { height: layout.iconBorder, backgroundColor: colour.rule },
  section: { gap: space.sm },
});

const pressedRow = [styles.row, styles.pressed];
