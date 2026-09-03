import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body } from '@/components/type';
import type { StrengthRowView } from '@/lib/scoreboard';
import { C } from '@/lib/theme';

// STRENGTH — what is new on the board, and the two lifts it is new about.
//
// The six live lift cards, their sparklines and the sessions-a-week bars are all behind
// this door (app/progress/strength.tsx), which also carries "All lifts" — and, since
// 2026-09-03, the movers themselves.
//
// The tile used to list two of them under a rule: the exercise on the left, its prescription
// right-aligned in green. Both halves truncated against each other at tile width — "Repeat
// 30 lb to set a baselin…" beside "Farmer's Carry" — which made the most actionable line on
// the page the least readable one (field report: "too cramped, too dense"). A prescription
// needs a full line to be worth reading, and it gets one behind the door. What stays is the
// news and how many lifts it is about.

export function StrengthTile({
  strength,
  loading,
  onOpen,
}: {
  strength: StrengthRowView;
  loading: boolean;
  onOpen: () => void;
}) {
  const empty = strength.count === 0;

  return (
    <Tile
      testID="tile-strength"
      accessibilityLabel={`Strength, ${strength.count} lifts`}
      onPress={empty && loading ? undefined : onOpen}>
      <TileHead
        eyebrow={empty ? 'Strength' : `Strength · ${strength.count} lift${strength.count === 1 ? '' : 's'}`}
        right={empty && loading ? null : <Chevron />}
      />
      <Body testID="strength-news" style={{ marginTop: 4 }}>
        {loading && empty ? 'Reading your log…' : strength.news}
        {strength.movers.length > 0 ? (
          <Body testID="strength-waiting" style={{ color: C.mute }}>
            {` · ${strength.movers.length} waiting on you`}
          </Body>
        ) : null}
      </Body>
    </Tile>
  );
}
