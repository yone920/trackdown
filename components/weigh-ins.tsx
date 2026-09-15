import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Card, Chip, Row, Section } from '@/components/kit';
import { Sub } from '@/components/type';
import { clock } from '@/lib/format';
import { whenLabel } from '@/lib/progress-sections';
import { useDeleteRecord, useWeighIns } from '@/lib/queries';
import { C } from '@/lib/theme';
import type { WeighIn } from '@/lib/types';

// The weigh-ins, where a person can reach them.
//
// They lost their only open-day surface when Today's Body section came off in the
// Train / Eat / Home restructure. The numbers went on feeding the 7-day average, the goal
// card and the week — but the ROWS were unreachable, so somebody who logged 110 when they
// meant 210 could see the consequences everywhere and correct them nowhere (field report
// 2026-09-02). That is the worst shape a record can be in: loud and untouchable.
//
// Body state belongs on Progress, which is the "where am I" page. Every row is the same
// three targets a logged row has anywhere else — tap to correct in words, ✕ to take it
// back — because a weigh-in is a log like any other and there is no reason it should
// behave differently from a meal.

/** How many rows before the rest go behind "Earlier". A season of weigh-ins is a wall. */
const FIRST_PAGE = 8;

export function WeighIns() {
  const router = useRouter();
  const weighIns = useWeighIns();
  const remove = useDeleteRecord();
  const [expanded, setExpanded] = useState(false);

  const rows = weighIns.data ?? [];
  const shown = expanded ? rows : rows.slice(0, FIRST_PAGE);
  const today = localDate(new Date().toISOString());

  /**
   * A weigh-in corrects the way everything else does: the same review-and-tell sheet, told
   * in words (concept-v2 §Principles 7). `editDate` is the day the reading was LOGGED, not
   * today, because that is the day whose log the sheet reads it back from.
   */
  const correct = (row: WeighIn) =>
    router.push({
      pathname: '/log',
      params: { editDate: localDate(row.logged_at), editId: row.id, editKind: 'weight' },
    });

  return (
    <Section title="Weigh-ins" summary={rows.length > 0 ? `${rows.length}` : null}>
      {rows.length === 0 ? (
        <Card>
          <Sub testID="weigh-ins-empty" style={{ lineHeight: 18 }}>
            {weighIns.isLoading ? 'Reading your weigh-ins…' : 'No weigh-ins yet. Say what you weigh and they start here.'}
          </Sub>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {shown.map((row, index) => (
            <Row
              key={row.id}
              testID={`row-weight-${row.id}`}
              time={clock(row.logged_at)}
              title={`${row.weight_lb.toFixed(1)} lb`}
              sub={whenLabel(localDate(row.logged_at), today)}
              // A reading the app doubted and the user kept anyway says so, quietly and
              // permanently — it is the one row on this list worth a second look.
              right={row.confidence === 'low' ? 'check' : null}
              rightColor={C.accent}
              onPress={() => correct(row)}
              onDelete={() => remove.mutate({ kind: 'weight', id: row.id })}
              deleteLabel={`${row.weight_lb.toFixed(1)} lb`}
              divider={index < shown.length - 1}
            />
          ))}
        </Card>
      )}

      {rows.length > FIRST_PAGE && !expanded ? (
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <Chip
            testID="weigh-ins-more"
            label={`Earlier · ${rows.length - FIRST_PAGE} more`}
            onPress={() => setExpanded(true)}
          />
        </View>
      ) : null}
    </Section>
  );
}

/** The local calendar day a timestamp fell on — what the day log is keyed by. */
function localDate(at: string): string {
  const local = new Date(at);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}
