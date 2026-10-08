import { Text } from '@/ui/components/Text';

/** The round line (spec §2): the server's text, small and grey, one line, never translated or built here. */
export function StageLine({ text }: { text: string }) {
  return (
    <Text variant="metricUnit" numberOfLines={1} testID="stage-line">
      {text}
    </Text>
  );
}
