import { ScopedDay } from '@/components/scoped-day';

// The eating half of a past day, from the Eat calendar. Meals, macros and the day's total,
// and no training on it at all.
export default function EatDay() {
  return <ScopedDay scope="eat" />;
}
