import { useEffect } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { useScoringFixture } from '@/hooks/useScoringFixture';
import { ScoringMatchScreen } from '@/ui/screens/ScoringMatchScreen';

/**
 * Remote Scoring (plan S2-1 Tasks 10 and 11): the match saved by a scan, drawn by its sport's own screen
 * (`ScoringMatchScreen`: the same for every sport). A path that reaches the route with no match saved goes Home, through
 * the navigation port in an effect, so the port knows where the router is: a `<Redirect>` moves the router behind its
 * back, and the next `go('scoring')` is then taken for a move to where it already is. Whether the screen is held on is
 * the screens' to say, not the route's: the pad and the wait before it hold it, a state that needs a person to act does
 * not (owner ruling 9, applied by the controller on 2026-11-02).
 */
export default function ScoringRoute() {
  const fixtureId = useScoringFixture();
  const { navigation } = usePorts();
  useEffect(() => {
    if (fixtureId === null) navigation.go('home');
  }, [fixtureId, navigation]);
  if (fixtureId === null) return null;
  return <ScoringMatchScreen fixtureId={fixtureId} />;
}
