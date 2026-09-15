import { Redirect } from 'expo-router';

// Today became TRAIN (user decision 2026-09-01): each tab owns one verb, and this one owns
// the session. Eating moved to its own tab and the whole-day framing moved to Home. The
// route stays so nothing pointing at `/today` breaks — an older build, a kept deep link.
export default function Today() {
  return <Redirect href="/train" />;
}
