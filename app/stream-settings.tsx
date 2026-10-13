import { SettingsScreen } from '@/ui/screens/SettingsScreen';

/** R2: Stream Settings from Home's Live Stream tile, outside the mode, without Diagnostics. */
export default function HomeStreamSettingsRoute() {
  return <SettingsScreen from="home" />;
}
