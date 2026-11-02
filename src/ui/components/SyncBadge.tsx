import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet, View } from 'react-native';
import type { PadSync } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { Translator } from '@/i18n/translate';
import { Glyph } from '@/ui/components/Glyph';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type SyncBadgeProps = {
  readonly sync: PadSync;
  /** A tap opens History, where each tap's row says whether it is still sending; null where History is not offered. */
  readonly onPress: (() => void) | null;
};

/** Two digits and a plus: the most the badge draws (`padSyncBox` is sized for it, padFit.test.ts). */
const MOST_SHOWN = 99;

/**
 * Whether this phone's taps have reached the server, as a badge (owner, 2026-11-02: "remove sending word and have a
 * symbol/icon like green uparrow for sending"): an arrow up and the count, no words, and nothing at all while every tap
 * has gone. Lime arrow in a quiet outline while they are on their way. When they cannot go (offline, a link the door
 * shut, a server that keeps refusing) the same badge in caution orange with a heavier outline, the arrow stopped under
 * a bar, so the state does not rest on telling lime from orange (never red: red means ON AIR, AGENTS §5). A tap opens
 * History. A screen reader gets the words and the true count, not the drawing.
 */
export const SyncBadge = memo(function SyncBadge({ sync, onPress }: SyncBadgeProps) {
  const translator = useT();
  if (sync.kind === 'synced') return null;
  const trouble = sync.kind !== 'sending';
  const words = syncWords(sync, translator);
  const content = <BadgeContent sync={sync} trouble={trouble} />;
  // No History to open (a dead link's card names no match): a label, not a button that does nothing.
  if (onPress === null) {
    return (
      <View
        testID="sync"
        accessible
        accessibilityLabel={words}
        style={trouble ? troubleAtRest : sendingAtRest}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID="sync"
      accessibilityRole="button"
      accessibilityLabel={words}
      accessibilityHint={translator.t('scoring.history.title')}
      onPress={onPress}
      style={trouble ? troubleStyle : sendingStyle}
    >
      {content}
    </Pressable>
  );
});

/** The arrow and the count, hidden from a screen reader: the badge's label says both, once. */
const BadgeContent = memo(function BadgeContent({
  sync,
  trouble,
}: {
  readonly sync: Counted;
  readonly trouble: boolean;
}) {
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" style={styles.content}>
      <Glyph
        name={trouble ? 'upBlocked' : 'up'}
        tone={trouble ? 'caution' : 'lime'}
        size={layout.padSyncGlyph}
      />
      <Text testID="sync-count" variant="syncCount" style={trouble ? styles.troubleCount : null}>
        {sync.count > MOST_SHOWN ? `${MOST_SHOWN}+` : String(sync.count)}
      </Text>
    </View>
  );
});

type Counted = Exclude<PadSync, { readonly kind: 'synced' }>;

function syncWords(sync: Counted, { tp }: Translator): string {
  switch (sync.kind) {
    case 'sending':
      return tp('scoring.sync.sending', sync.count);
    case 'offline':
      return tp('scoring.sync.offline', sync.count);
    case 'refused':
      return tp('scoring.sync.refused', sync.count);
    case 'stalled':
      return tp('scoring.sync.stalled', sync.count);
  }
}

const styles = StyleSheet.create({
  badge: {
    minWidth: layout.iconButton,
    minHeight: layout.iconButton,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  // Heavier and orange: the box's edge says "stopped" at a glance, before the count is read.
  trouble: { borderWidth: layout.iconBorderOn, borderColor: colour.caution },
  content: { flexDirection: 'row', alignItems: 'center' },
  troubleCount: { color: colour.caution },
  pressedFill: { backgroundColor: colour.pressFill },
  pressedEdge: { borderColor: colour.ink },
});

const sendingAtRest = [styles.badge];
const troubleAtRest = [styles.badge, styles.trouble];
const sendingHeld = [styles.badge, styles.pressedFill, styles.pressedEdge];
const troubleHeld = [styles.badge, styles.trouble, styles.pressedFill, styles.pressedEdge];

/** Module-level so render allocates no function. Held, the badge takes the press fill and a cream edge, as IconButton does. */
function sendingStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? sendingHeld : sendingAtRest;
}
function troubleStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? troubleHeld : troubleAtRest;
}
