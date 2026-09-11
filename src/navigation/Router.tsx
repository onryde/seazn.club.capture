import { useState } from 'react';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { ScanScreen } from '@/ui/screens/ScanScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { ViewfinderScreen } from '@/ui/screens/ViewfinderScreen';

/**
 * Four destinations, one of which is reached by arming rather than by
 * navigating. React Navigation is deliberately not installed: it would add a
 * native dependency and a rebuild to serve a graph with no stack, no params
 * and no deep links. If navigation ever grows a second axis, revisit.
 */
export type Route = 'viewfinder' | 'settings' | 'diagnostics';

export function Router() {
  const [route, setRoute] = useState<Route>('viewfinder');
  const stateKind = useEngineSelector(selectStateKind);

  // Mounted here rather than in a screen: the screen unmounts when Settings or
  // Diagnostics opens, and the screen going away is not a reason to let the
  // phone lock mid-match.
  useKeepAwake();

  // Scanning is not a route: it is what the app shows until it holds
  // credentials. Arming replaces it, and going live must never navigate.
  if (stateKind === 'idle') return <ScanScreen />;

  switch (route) {
    case 'settings':
      return <SettingsScreen onBack={() => setRoute('viewfinder')} />;
    case 'diagnostics':
      return <DiagnosticsScreen onBack={() => setRoute('viewfinder')} />;
    case 'viewfinder':
      return (
        <ViewfinderScreen
          onOpenSettings={() => setRoute('settings')}
          onOpenDiagnostics={() => setRoute('diagnostics')}
        />
      );
  }
}
