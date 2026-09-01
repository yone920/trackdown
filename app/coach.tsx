import { Redirect } from 'expo-router';

// The coach page became the "Do" section of Today (user decision 2026-09-01): the plan and
// the record of what you actually did are two halves of one day and belong on one screen.
// This route stays so nothing that already points at `/coach` breaks — an older build, a
// link in a brief, a deep link someone kept. It renders nothing and redirects.
export default function Coach() {
  return <Redirect href="/train" />;
}
