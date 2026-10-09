import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { peekPlaybackUrl } from '@/domain/session/previewUrls';
import { usePorts } from '@/hooks/usePorts';
import type { VideoStatus } from '@/services/surfaces';

type StageVideoProps = {
  /** The descriptor's playback URL; the view's bandwidth hint is added here. It goes to the player only. */
  readonly url: string;
  /** The player's remount key: a retry is a fresh player. */
  readonly attempt: number;
  readonly onStatus: (status: VideoStatus) => void;
};

/**
 * The delivered picture, muted, fetched live, never cached (D37): the Video surface owns all three. It takes no touch:
 * the cover over it does. Mounted only while the view is open and the feed is playing, so closing the view stops the
 * download (D2 §4.3). The lines over it are the cover's.
 */
export const StageVideo = memo(function StageVideo({ url, attempt, onStatus }: StageVideoProps) {
  const { surfaces } = usePorts();
  const { Video } = surfaces;
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Video key={attempt} url={peekPlaybackUrl(url)} playing onStatus={onStatus} />
    </View>
  );
});

// RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone.
const styles = StyleSheet.create({ fill: { ...StyleSheet.absoluteFill } });
