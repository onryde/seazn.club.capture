import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useOptionalNativeModule } from '@/hooks/useOptionalNativeModule';
import { PeekNotice } from '@/ui/components/PeekNotice';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * What viewers actually get, pulled back over LL-HLS (WHEP is unavailable from
 * an SRT input — N11).
 *
 * This is the only signal that tells an operator the Fly Machine is alive and
 * the score is flowing; a local overlay cannot. It is also roughly six seconds
 * behind, so it is for *verifying*, never for framing.
 *
 * `expo-video` is not in Expo Go, so it is loaded dynamically — importing it
 * statically throws at module load and kills the whole app before React
 * renders. In a development build this simply works.
 */
type VideoModule = typeof import('expo-video');

const loadVideo = () => import('expo-video');

export function OutputPreview({ url, visible }: { url: string; visible: boolean }) {
  const video = useOptionalNativeModule<VideoModule>(loadVideo);

  if (video.status === 'ready') {
    return <VideoSurface video={video.module} url={url} visible={visible} />;
  }

  return (
    <PeekNotice
      visible={visible}
      message={
        video.status === 'loading'
          ? 'Connecting to the broadcast…'
          : 'Output check is not available in this build.'
      }
    />
  );
}

function VideoSurface({
  video,
  url,
  visible,
}: {
  video: VideoModule;
  url: string;
  visible: boolean;
}) {
  // Muted, always. The microphone is live: playing the broadcast's own audio
  // out of the handset speaker would feed straight back into the stream.
  const player = video.useVideoPlayer(url, (instance) => {
    instance.muted = true;
    instance.loop = false;
  });

  // Only pull bytes while the operator is looking. Peeking is billed delivery,
  // and this runs on the device least able to spare radio and battery.
  useEffect(() => {
    if (visible) player.play();
    else player.pause();
  }, [player, visible]);

  const Surface = video.VideoView;

  return (
    <View style={[styles.clip, visible ? null : styles.hidden]} pointerEvents="none">
      <Surface player={player} style={styles.video} contentFit="contain" nativeControls={false} />
      <View style={styles.caption}>
        <Text variant="metricUnit">What viewers see, about 6 seconds behind</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colour.ground,
  },
  hidden: {
    opacity: 0,
  },
  video: {
    flex: 1,
  },
  caption: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
  },
});
