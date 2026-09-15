import { DaysList } from '@/components/days-list';
import { DetailScreen } from '@/components/progress/detail-screen';

// Every day, at length — the archive behind the Progress page's three-day row (user
// decision 2026-09-02).
//
// Days was a tab, then the top section of Progress, and now it is a screen one tap from the
// row that summarises it: three days on the page, everything before them in here. Nothing
// about a day changed on any of those moves — the verdict dot, the week tally, the day
// number and where a tap goes are all `components/days-list.tsx`. Only the container has.
export default function Days() {
  return (
    <DetailScreen testID="days-detail" title="Days">
      <DaysList />
    </DetailScreen>
  );
}
