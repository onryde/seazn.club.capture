import { AppState, type AppStateStatus } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeForeground } from '@/services/native/nativeForeground';

type Listener = (state: AppStateStatus) => void;

/** AppState's own listener list, stubbed so a test can play the states a phone reports. */
function stubAppState() {
  const listeners: Listener[] = [];
  const remove = vi.fn();
  vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as Listener);
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const emit = (state: AppStateStatus) => {
    for (const listener of listeners) listener(state);
  };
  return { emit, remove };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the foreground port over AppState (N2)', () => {
  // iOS reports a call, Control Centre or the app switcher as `inactive`
  // without ever reaching `background`: a hold must be abandoned there too
  // (ruling M5). Whether iOS says `inactive` for a call is an iOS device check.
  it('calls every state but active a departure, iOS inactive included', () => {
    const appState = stubAppState();
    const onBackground = vi.fn();
    createNativeForeground().subscribeBackground(onBackground);
    appState.emit('inactive');
    expect(onBackground).toHaveBeenCalledTimes(1);
    appState.emit('background');
    expect(onBackground).toHaveBeenCalledTimes(2);
    appState.emit('active');
    expect(onBackground).toHaveBeenCalledTimes(2);
  });

  it('calls only active a return', () => {
    const appState = stubAppState();
    const onForeground = vi.fn();
    createNativeForeground().subscribe(onForeground);
    appState.emit('inactive');
    appState.emit('background');
    expect(onForeground).not.toHaveBeenCalled();
    appState.emit('active');
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it.each(['subscribe', 'subscribeBackground'] as const)(
    'stops listening through the subscription’s remove (%s)',
    (method) => {
      const appState = stubAppState();
      const unsubscribe = createNativeForeground()[method](vi.fn());
      expect(appState.remove).not.toHaveBeenCalled();
      unsubscribe();
      expect(appState.remove).toHaveBeenCalledTimes(1);
    },
  );
});
