import { ScopedDay } from '@/components/scoped-day';

// The training half of a past day, from the Train calendar (user decision 2026-09-02:
// history is domain-scoped, the same way the tabs are). The whole-day reading — verdict,
// In short, eating, body — is still `/day/<date>`, behind Progress.
export default function TrainDay() {
  return <ScopedDay scope="train" />;
}
