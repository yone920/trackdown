import { Redirect } from 'expo-router';

// The coach page became the Plan tab (user decision 2026-09-01, app/(tabs)/plan.tsx).
// This route stays so nothing that already points at `/coach` breaks — an older build of
// the app, a link in a brief, a deep link someone kept. It renders nothing and redirects.
export default function Coach() {
  return <Redirect href="/plan" />;
}
