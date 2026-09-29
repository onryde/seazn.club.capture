import { Stack, usePathname, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativePorts } from '@/hooks/nativePorts';
import { useAppFonts } from '@/hooks/useAppFonts';
import { LanguageProvider } from '@/hooks/useLanguage';
import { routeTarget } from '@/hooks/useOrientationGate';
import { PortsProvider, usePorts, type Ports } from '@/hooks/usePorts';
import { useReopenGate } from '@/hooks/useReopenGate';
import { BootFailure } from '@/ui/components/BootFailure';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { OrientationGate } from '@/ui/components/OrientationGate';
import { ShellFrame } from '@/ui/components/ShellFrame';

// The splash holds until the shell knows where to land: no spinner (AGENTS §6).
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ports] = useState(createNativePorts);
  const fonts = useAppFonts();
  if (fonts === 'loading') return null;
  // onCatch: a render error must never sit behind a splash that never lifts (R15).
  return (
    <ErrorBoundary onCatch={ports.splash.hide}>
      <ShellProviders ports={ports}>
        {fonts === 'failed' ? <BootFailureShown /> : <Shell />}
      </ShellProviders>
    </ErrorBoundary>
  );
}

/** Kept beside the layout: app/ may import safe-area-context, src/ui may not. */
function ShellProviders({ ports, children }: { ports: Ports; children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <PortsProvider ports={ports}>
        <LanguageProvider>{children}</LanguageProvider>
      </PortsProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  // Expo Router refuses navigation before the root navigator has mounted.
  const navigatorReady = useRootNavigationState()?.key !== undefined;
  // The gate decides where to land, then hides the splash (spec §4).
  useReopenGate(navigatorReady);
  const target = routeTarget(usePathname());
  return (
    <ShellFrame>
      <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
      <OrientationGate target={target} />
    </ShellFrame>
  );
}

function BootFailureShown() {
  const { splash } = usePorts();
  useEffect(() => splash.hide(), [splash]);
  return <BootFailure />;
}
