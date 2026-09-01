import { Redirect } from 'expo-router';

// Days folded into Progress (user decision 2026-09-01): the list of closed days is the top
// section of the Progress page, and the tab bar went to five — Home · Today · Eat ·
// Progress · You. This route stays so nothing that already points at `/days` breaks.
export default function Days() {
  return <Redirect href="/progress" />;
}
