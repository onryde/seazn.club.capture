export type ScreenLayout = 'portrait' | 'landscape';

/** Wider than tall is landscape; a square window is portrait. */
export function screenLayout(width: number, height: number): ScreenLayout {
  return width > height ? 'landscape' : 'portrait';
}
