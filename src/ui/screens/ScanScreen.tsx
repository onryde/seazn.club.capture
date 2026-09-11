import { StyleSheet, View } from 'react-native';
import { parseSessionCredentials } from '@/domain/credentials/parseSessionCredentials';
import { useEngine } from '@/hooks/useCaptureEngine';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * The QR code IS the credential (AGENTS.md §1). There is no login: an operator
 * is a volunteer handed a phone at a wet ground, and a sign-in screen there is
 * a product failure.
 *
 * PLACEHOLDER SCANNER. Two things block the real one, and neither is UI work:
 *  - `contracts/capture-qr.v1.json` is mid-revision (C1, C2, M3, N2, N8).
 *  - Camera ownership is undecided. §11 forbids `expo-camera` because the
 *    streaming engines own the capture session; scanning happens before arming
 *    so they never overlap, but the engine may be the right place to expose it.
 *
 * Until then this arms from a fixture payload so every downstream screen is
 * reachable and reviewable.
 */
const FIXTURE_PAYLOAD = {
  v: 1,
  slotId: 'slot-a',
  holdWindowSeconds: 60,
  preferred: 'srt',
  overlayUrl: 'https://example.org/overlay/fixtures/fixture',
  playbackUrl: 'https://example.org/fixture/manifest.m3u8',
  scoreUpdates: 'realtime',
  srt: { url: 'srt://ingest.example:9001', streamId: 'fixture', latencyMs: 2000 },
  rtmps: { url: 'rtmps://ingest.example/live', streamKey: 'fixture-key' },
};

/** Parsed once at module scope — it is a pure call on a constant. */
const FIXTURE = parseSessionCredentials(FIXTURE_PAYLOAD);

export function ScanScreen() {
  const engine = useEngine();
  const parsed = FIXTURE;

  // One centred stack: there is no camera preview to keep clear here, so the
  // action sits directly under the instruction it completes.
  return (
    <View style={styles.screen}>
      <Text variant="title" style={styles.centred}>
        Scan the fixture code
      </Text>
      <Text variant="body" style={[styles.copy, styles.centred]}>
        Open the fixture page on a laptop and point this phone at the code. It carries everything
        needed to go live — there is nothing to sign in to.
      </Text>
      {/* Developer note. Gated so it cannot reach a club. */}
      {__DEV__ ? (
        <Text variant="metricUnit" style={styles.centred}>
          Scanner pending the QR contract and a camera-ownership decision.
        </Text>
      ) : null}

      {/* Scan in floodlight. Until the scanner exists (see the note above),
          it arms from the fixture payload so every later screen is reachable. */}
      <View style={styles.action}>
        <Button
          label="Scan"
          disabled={!parsed.ok}
          onPress={() => {
            if (parsed.ok) engine.send({ kind: 'arm', credentials: parsed.value });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.ground,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    gap: space.md,
  },
  centred: {
    textAlign: 'center',
  },
  copy: {
    maxWidth: 420,
  },
  // Breathing room between the instruction and the plate.
  action: {
    marginTop: space.sm,
  },
});
