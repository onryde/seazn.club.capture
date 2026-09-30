import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Mode } from '@/domain/mode/Mode';
import { BUILT_MODES } from '@/domain/mode/scanOutcome';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useHome, type HomeActions, type HomeView } from '@/hooks/useHome';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { CodePanel } from '@/ui/components/CodePanel';
import { ContinueCard } from '@/ui/components/ContinueCard';
import { DevPaste } from '@/ui/components/DevPaste';
import { HomeFooter } from '@/ui/components/HomeFooter';
import { StatusLine } from '@/ui/components/StatusLine';
import { Text } from '@/ui/components/Text';
import { Tile } from '@/ui/components/Tile';
import { MODES } from '@/ui/modeCopy';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Layout A (spec §7): brand, status, Continue, three equal tiles, footer; the
 * panel over all. Back closes the panel (R31).
 */
export function HomeScreen() {
  const { view, actions } = useHome();
  useBackCloses(view.panel !== null, actions.closePanel);
  return (
    <View style={styles.screen}>
      <HomeContent view={view} actions={actions} />
      {view.panel === null ? null : (
        <CodePanel
          outcome={view.panel}
          time={view.panelTime}
          onOpen={actions.openFromPanel}
          onScanAgain={actions.scanAgain}
          onClose={actions.closePanel}
          onTryAgain={actions.retryCheck}
        />
      )}
    </View>
  );
}

/**
 * Everything behind the panel, hidden from screen readers while it is up.
 * `aria-modal` on the sheet holds VoiceOver only; TalkBack needs Home itself
 * hidden. RN 0.86's View already maps `aria-hidden` to Android's
 * `importantForAccessibility="no-hide-descendants"`; the explicit prop keeps
 * that true if the mapping ever changes. react-native-web reads only
 * `aria-hidden`, which is what the tests assert.
 */
function HomeContent({ view, actions }: { view: HomeView; actions: HomeActions }) {
  const { t } = useT();
  const { appVersion, devTools } = usePorts();
  const behindPanel = view.panel !== null;
  return (
    <View
      style={styles.content}
      aria-hidden={behindPanel}
      importantForAccessibility={behindPanel ? 'no-hide-descendants' : 'auto'}
    >
      <Text variant="title">{t('brand')}</Text>
      <StatusLine>{view.statusText}</StatusLine>
      <ContinueSlot view={view} actions={actions} />
      <ModeTiles onPress={actions.tapTile} />
      {devTools ? <DevPaste onUse={actions.useRaw} /> : null}
      <HomeFooter version={appVersion} />
    </View>
  );
}

/** The Continue card, only when a left mode still holds a valid code. */
function ContinueSlot({ view, actions }: { view: HomeView; actions: HomeActions }) {
  const code = view.continueCode;
  if (code === null) return null;
  return (
    <ContinueCard
      mode={code.mode}
      slot={code.slot}
      validTill={view.continueTill ?? ''}
      onContinue={actions.continueStream}
      onForget={actions.forgetStream}
    />
  );
}

const ModeTiles = memo(function ModeTiles({ onPress }: { onPress: (mode: Mode) => void }) {
  return (
    <View style={styles.tiles}>
      {MODES.map((mode) => (
        <Tile key={mode} mode={mode} available={BUILT_MODES.includes(mode)} onPress={onPress} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.md, backgroundColor: colour.ground },
  content: { flex: 1, gap: space.sm },
  tiles: { flex: 1, gap: space.sm },
});
