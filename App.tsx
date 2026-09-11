import { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { type Edge, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { createFakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { EngineProvider } from '@/hooks/useCaptureEngine';
import { SettingsProvider } from '@/hooks/useSettings';
import { Router } from '@/navigation/Router';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { colour, status } from '@/ui/theme/tokens';

/**
 * Composition root.
 *
 * The fake engine is wired here and nowhere else — when HaishinKit.swift and
 * StreamPack land, this single line changes and no screen notices. That is the
 * whole return on the port (AGENTS.md §4).
 *
 * Fonts are the product's own three faces — Barlow Condensed for display,
 * Geist for body, Geist Mono for numerals — matching `globals.css`.
 *
 * Imported by per-weight subpath, and by NAMED import: the subpath modules
 * export `const GeistMono_400Regular`, with no default. `esModuleInterop`
 * happily synthesises a default, so a default import typechecks, bundles, and
 * hands `useFonts` six `undefined`s at runtime — a silent blank screen.
 *
 * Importing from the package root instead would work but pulls all 32 weights
 * and italics — roughly 4.3MB — because Metro cannot tree-shake asset requires.
 */
export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    Geist_400Regular,
    Geist_500Medium,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  const engine = useMemo(() => createFakeCaptureEngine(), []);

  // §6 says never show an unexplained blank, and that applies hardest to
  // startup: a silent dark screen here is indistinguishable from a crash. The
  // system face is used deliberately — the scale needs faces that have not
  // arrived yet, and a readable fallback beats a mystery.
  if (fontError !== null) {
    return (
      <Boot message={`Typefaces failed to load. ${fontError.message}`} tone={status.failure} />
    );
  }
  if (!fontsLoaded) return <Boot message="Starting…" tone={colour.ink3} />;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SettingsProvider>
          <EngineProvider engine={engine}>
            <SafeAreaView style={styles.root} edges={ALL_EDGES}>
              <StatusBar hidden />
              <Router />
            </SafeAreaView>
          </EngineProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

/**
 * Every edge, once, at the root. Android 15+ draws apps edge to edge and
 * targetSdk 36 removes the opt-out, so in landscape the navigation bar sits on
 * top of the control column and the camera cutout on top of the other side.
 * Found on a OnePlus 10 Pro: the column's text ran 28dp under the nav bar.
 */
const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

function Boot({ message, tone }: { message: string; tone: string }) {
  return (
    <View style={[styles.root, styles.boot]}>
      <RNText style={[styles.bootText, { color: tone }]}>{message}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colour.ground,
  },
  boot: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  bootText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
