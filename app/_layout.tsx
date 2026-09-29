import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativePorts } from '@/hooks/nativePorts';
import { useAppFonts } from '@/hooks/useAppFonts';
import { LanguageProvider } from '@/hooks/useLanguage';
import { PortsProvider, usePorts } from '@/hooks/usePorts';
import { BootFailure } from '@/ui/components/BootFailure';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { ShellFrame } from '@/ui/components/ShellFrame';

// The splash holds until the shell knows where to land: no spinner (AGENTS §6).
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ports] = useState(createNativePorts);
  const fonts = useAppFonts();
  if (fonts === 'loading') return null;
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <PortsProvider ports={ports}>
          <LanguageProvider>
            {fonts === 'failed' ? <BootFailureShown /> : <Shell />}
          </LanguageProvider>
        </PortsProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

function Shell() {
  const { splash } = usePorts();
  // Task 12 replaces this with the reopen gate, which hides the splash once it has decided.
  useEffect(() => splash.hide(), [splash]);
  return (
    <ShellFrame>
      <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
    </ShellFrame>
  );
}

function BootFailureShown() {
  const { splash } = usePorts();
  useEffect(() => splash.hide(), [splash]);
  return <BootFailure />;
}
