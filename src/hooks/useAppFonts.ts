import { useFonts } from 'expo-font';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';

/**
 * The product's three faces. Imported by per-weight subpath and by NAMED
 * import: the subpath modules have no default export, and a default import
 * typechecks, bundles, and hands useFonts six `undefined`s — a silent blank
 * screen. The package root would pull all 32 weights (~4.3 MB).
 */
export function useAppFonts(): 'loading' | 'ready' | 'failed' {
  const [loaded, error] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    Geist_400Regular,
    Geist_500Medium,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });
  if (error !== null) return 'failed';
  return loaded ? 'ready' : 'loading';
}
