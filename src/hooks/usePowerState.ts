import { useEffect, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';

/**
 * R5: the battery state, read at mount and again at every return to the foreground (the operator may have changed it
 * on the battery page), and the way to that page.
 */
export function usePowerState(): { readonly unrestricted: boolean | null; open(): void } {
  const { power, foreground } = usePorts();
  const [unrestricted, setUnrestricted] = useState(() => power.isUnrestricted());
  useEffect(
    () => foreground.subscribe(() => setUnrestricted(power.isUnrestricted())),
    [power, foreground],
  );
  return { unrestricted, open: power.openBatterySettings };
}
