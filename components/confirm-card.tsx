import { Pressable, View } from 'react-native';

import { IconClose } from '@/components/icons';
import { Card, Chip, Chips } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { C, FONT, TABULAR } from '@/lib/theme';
import type {
  ActivityItem,
  Confidence,
  FieldSource,
  FusionResult,
  GoalFacts,
  MealConsistency,
  ProposedTimeline,
} from '@/lib/types';

// The confirm card (docs/design-system.md §Log). "Confirm, don't trust": every reading is
// shown before it counts, with what each fact came from and how sure the model was
// (concept-v2 §Principles 3).
//
// **It is read-only, and that is the product law rather than a styling choice.** NO FORMS
// (concept-v2 §Principles 7, user decision 2026-08-31): the user types it, says it or
// photographs it, the app shows what it understood, and a correction is TOLD — "reps were
// 3, not 4" — through the same input that made the log. There is no field to type into
// here, and there is none anywhere else in the app but the sign-in screen. The card used
// to carry a grid of TextInputs; the review step (app/log.tsx) and "Make a change"
// replaced it.
//
// The one thing that still changes a value from this card is the refinement chip, and it
// is one tap on an offer the reader derived ("Was it a Chest-Supported Row?") rather than
// a field: no keyboard, no cursor, nothing to fill in.
//
// It renders *every* kind the classifier can return, including `unclear` — which asks one
// question instead of guessing (backend/src/services/fusion/schema.ts).
//
// One card is one PART of a log. "Ate two eggs, ran 5k, weighed in at 181" is three of
// these stacked, each removable with the ✕, under one "Log it".

const KIND_LABEL: Record<FusionResult['kind'], string> = {
  activities: 'exercise',
  meal: 'meal',
  weight: 'weight',
  goal: 'goal',
  constraint: 'constraint',
  preference: 'preference',
  coach_context: 'context',
  unclear: 'unclear',
};

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: C.good,
  medium: C.mute,
  low: C.accent,
};

const MEAL_SLOT: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** A fact and its label, as text. Nothing here is editable — see the note above. */
function Facts({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>{children}</View>;
}

function Fact({
  label,
  value,
  width = '30%',
  numeric = false,
  testID,
}: {
  label: string;
  value: string | number | null | undefined;
  width?: `${number}%` | number;
  numeric?: boolean;
  testID?: string;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={{ flexGrow: 1, flexBasis: width }}>
      <Eyebrow>{label}</Eyebrow>
      <Body
        testID={testID}
        style={
          numeric
            ? [{ marginTop: 4, fontFamily: FONT.disp, fontSize: 18, color: C.ink }, TABULAR]
            : { marginTop: 4, fontFamily: FONT.disp, fontSize: 18, color: C.ink }
        }>
        {String(value)}
      </Body>
    </View>
  );
}

/**
 * What the chip says, in words. It used to print the wire value — a bare "HIGH" beside a
 * meal, which a user read as "high calories" (reported 2026-08-31). It is about how sure
 * the *reading* was, and only the low one is asking for anything.
 */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence — check me',
};

function ConfidenceChip({ level, testID }: { level: Confidence; testID?: string }) {
  const color = CONFIDENCE_COLOR[level];
  return (
    <View
      testID={testID}
      style={{
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: level === 'high' ? C.track : color,
      }}>
      <Sub style={{ color, fontSize: 11, fontFamily: level === 'low' ? FONT.semi : FONT.medium }}>
        {CONFIDENCE_LABEL[level]}
      </Sub>
    </View>
  );
}

/** "machine from the photo, load from your words" — provenance, per docs/design-system.md. */
export function sourcesLine(sources: Record<string, FieldSource> | null | undefined): string | null {
  if (!sources) return null;
  const pretty = (field: string) => field.replace(/_lb$|_g$|_min$|_mi$/, '').replace(/_/g, ' ');
  const fromPhoto = Object.entries(sources)
    .filter(([, source]) => source === 'photo')
    .map(([field]) => pretty(field));
  const fromText = Object.entries(sources)
    .filter(([, source]) => source === 'text')
    .map(([field]) => pretty(field));
  const parts: string[] = [];
  if (fromPhoto.length > 0) parts.push(`${fromPhoto.join(', ')} from the photo`);
  if (fromText.length > 0) parts.push(`${fromText.join(', ')} from your words`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * What the server's arithmetic gate made of a meal's numbers, in one quiet line under the
 * plate (backend services/fusion/arithmetic.ts). Null when the reading added up first time,
 * which is nearly always — this line exists for the reading that did not.
 *
 * The field case it is written for: kcal 918 beside 67 g protein, 398 g carbs and 35 g fat,
 * which is 2,175 kcal of macros, marked HIGH. The chip already says "Low confidence — check
 * me" whenever the gate forced it; this says WHY, because "check me" with no reason is a
 * shrug and the user cannot see the multiplication.
 */
export function consistencyLine(consistency: MealConsistency | null | undefined): string | null {
  if (!consistency) return null;
  const stated = consistency.stated_kcal;
  const implied = consistency.implied_kcal;
  const sum =
    stated != null && implied != null
      ? ` — ${Math.round(stated).toLocaleString('en-US')} kcal against ${Math.round(
          implied,
        ).toLocaleString('en-US')} from the macros`
      : '';
  return consistency.outcome === 'adjusted'
    ? `The numbers didn’t add up${sum}; read again and adjusted.`
    : `The numbers didn’t add up${sum}; flagged, not adjusted.`;
}

function timelineLine(timeline: ProposedTimeline | null): string | null {
  if (!timeline) return null;
  const parts = [timeline.rate, timeline.by ? `→ ${timeline.by}` : null, timeline.note].filter(Boolean);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * "Also noting: 212 lb today · 4 days/week · gym · 45" — what the server picked up from the
 * same sentence and is about to save alongside the goal. Shown because it is being written:
 * a fact saved silently is a fact the user cannot correct (concept-v2 §Principles 3).
 */
export function notedFactsLine(facts: GoalFacts | null | undefined): string | null {
  if (!facts) return null;
  const parts = [
    facts.current_weight_lb == null ? null : `${facts.current_weight_lb} lb today`,
    facts.training_days == null ? null : `${facts.training_days} days/week`,
    facts.environment,
    facts.age_years == null ? null : `${facts.age_years} years old`,
  ].filter(Boolean);
  return parts.length === 0 ? null : `Also noting: ${parts.join(' · ')}`;
}

export type DateChoice = 'proposed' | 'confirm_date' | 'no_date';

export function ConfirmCard({
  result,
  onChange,
  onRemove,
  dateChoice = 'proposed',
  onDateChoice,
  eyebrow,
  testID = 'confirm-card',
}: {
  result: FusionResult;
  /**
   * The refinement chip's one tap, and nothing else. There is no field on this card, so
   * every other change to a result is told through the input (app/log.tsx).
   */
  onChange?: (next: FusionResult) => void;
  /** Drops this part from the log. */
  onRemove?: () => void;
  dateChoice?: DateChoice;
  onDateChoice?: (choice: DateChoice) => void;
  /** Overrides "Recognized · <kind>" — a correction was recognized a while ago. */
  eyebrow?: string;
  testID?: string;
}) {
  const patchActivity = (index: number, patch: Partial<ActivityItem>) => {
    if (result.kind !== 'activities' || !onChange) return;
    const items = result.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...result, items });
  };

  return (
    <Card testID={testID} style={{ marginTop: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Eyebrow>{eyebrow ?? `Recognized · ${KIND_LABEL[result.kind]}`}</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {'confidence' in result ? <ConfidenceChip level={result.confidence} testID={`${testID}-confidence`} /> : null}
          {onRemove ? (
            <Pressable
              accessibilityLabel={`Remove this ${KIND_LABEL[result.kind]}`}
              testID={`${testID}-remove`}
              onPress={onRemove}
              hitSlop={8}
              style={{ padding: 2 }}>
              <IconClose size={18} color={C.mute} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {result.kind === 'activities' ? (
        <View>
          {result.items.map((item, index) => (
            <View key={index} style={{ marginTop: index === 0 ? 12 : 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Disp size={22} style={{ flex: 1 }}>
                  {item.exercise ?? item.description}
                </Disp>
                <ConfidenceChip level={item.confidence} testID={`activity-confidence-${index}`} />
              </View>
              {/* The machine, when they named one. It reads as the sub-line because it is
                  how the row is recognised when the movement is only a guess. */}
              {item.equipment ? (
                <Sub testID={`activity-equipment-line-${index}`} style={{ marginTop: 4 }}>
                  {item.equipment}
                </Sub>
              ) : null}
              {sourcesLine(item.sources) ? (
                <Sub style={{ marginTop: 4 }}>{sourcesLine(item.sources)}</Sub>
              ) : null}
              {/* An offer, never a question, and the one tap on this card that changes a
                  value: no field, no keyboard. It can be ignored forever. */}
              {onChange && item.refine && item.refine.exercise !== item.exercise ? (
                <View style={{ marginTop: 10 }}>
                  <Chips>
                    <Chip
                      testID={`activity-refine-${index}`}
                      label={item.refine.question}
                      onPress={() => patchActivity(index, { exercise: item.refine!.exercise, refine: null })}
                    />
                  </Chips>
                </View>
              ) : null}
              <Facts>
                <Fact label="Sets" numeric value={item.sets} testID={`activity-sets-${index}`} />
                <Fact label="Reps" numeric value={item.reps} testID={`activity-reps-${index}`} />
                <Fact label="Load lb" numeric value={item.load_lb} testID={`activity-load-${index}`} />
                <Fact label="Minutes" numeric value={item.duration_min} />
                <Fact label="Miles" numeric value={item.distance_mi} />
                <Fact label="Kcal" numeric value={item.kcal} />
              </Facts>
            </View>
          ))}
        </View>
      ) : null}

      {result.kind === 'meal' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>{result.description}</Disp>
          {result.meal_type ? (
            <Sub testID="meal-slot" style={{ marginTop: 4 }}>
              {MEAL_SLOT[result.meal_type] ?? result.meal_type}
            </Sub>
          ) : null}
          {sourcesLine(result.sources) ? <Sub style={{ marginTop: 4 }}>{sourcesLine(result.sources)}</Sub> : null}
          {consistencyLine(result.consistency) ? (
            <Sub testID="meal-consistency" style={{ marginTop: 4, color: C.accent }}>
              {consistencyLine(result.consistency)}
            </Sub>
          ) : null}
          <Facts>
            <Fact label="Kcal" numeric value={result.kcal} testID="meal-kcal" />
            <Fact label="Protein g" numeric value={result.protein_g} />
            <Fact label="Carbs g" numeric value={result.carbs_g} />
            <Fact label="Fat g" numeric value={result.fat_g} />
            <Fact label="Fibre g" numeric value={result.fiber_g} />
          </Facts>
          {result.items.length > 0 ? (
            <Sub style={{ marginTop: 12 }}>{result.items.map((item) => item.name).join(' · ')}</Sub>
          ) : null}
        </View>
      ) : null}

      {result.kind === 'weight' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>Weigh-in</Disp>
          {sourcesLine(result.sources) ? <Sub style={{ marginTop: 4 }}>{sourcesLine(result.sources)}</Sub> : null}
          <Facts>
            <Fact label="Weight lb" numeric width="46%" value={result.weight_lb} testID="weight-lb" />
          </Facts>
        </View>
      ) : null}

      {result.kind === 'goal' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>{result.spec.title}</Disp>
          <Sub style={{ marginTop: 4 }}>
            {result.spec.metrics
              .map((metric) =>
                [metric.measure, metric.target != null ? `→ ${metric.target}${metric.unit ? ` ${metric.unit}` : ''}` : null]
                  .filter(Boolean)
                  .join(' '),
              )
              .join(' · ') || 'A standing intention'}
          </Sub>
          {timelineLine(result.proposed_timeline) ? (
            <Body style={{ marginTop: 10 }}>{timelineLine(result.proposed_timeline)}</Body>
          ) : null}
          {/* What else the same sentence said about them, and is about to be saved. */}
          {notedFactsLine(result.facts) ? (
            <Sub testID="goal-noted-facts" style={{ marginTop: 8 }}>
              {notedFactsLine(result.facts)}
            </Sub>
          ) : null}
          {/* The proposal is an offer, not a correction (concept-v2 §Goals) — three
              alternatives to pick between, not a date to type. */}
          {onDateChoice ? (
            <View style={{ marginTop: 14 }}>
              <Chips>
                <Chip
                  label={result.proposed_timeline?.by ? `Use ${result.proposed_timeline.by}` : 'Use the projection'}
                  variant={dateChoice === 'proposed' ? 'primary' : 'secondary'}
                  onPress={() => onDateChoice('proposed')}
                />
                <Chip
                  label="Keep my date"
                  variant={dateChoice === 'confirm_date' ? 'primary' : 'secondary'}
                  onPress={() => onDateChoice('confirm_date')}
                />
                <Chip
                  label="No date"
                  variant={dateChoice === 'no_date' ? 'primary' : 'secondary'}
                  onPress={() => onDateChoice('no_date')}
                />
              </Chips>
            </View>
          ) : null}
        </View>
      ) : null}

      {result.kind === 'constraint' || result.kind === 'preference' || result.kind === 'coach_context' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>
            {result.kind === 'constraint'
              ? 'A constraint'
              : result.kind === 'preference'
                ? 'A preference'
                : 'Context for the coach'}
          </Disp>
          {result.kind === 'coach_context' ? (
            <Sub style={{ marginTop: 4 }}>Used the next time you ask, then gone.</Sub>
          ) : null}
          <Body testID="statement-text" style={{ marginTop: 12, lineHeight: 15 * 1.55 }}>
            {`“${result.text}”`}
          </Body>
        </View>
      ) : null}

      {result.kind === 'unclear' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>One question</Disp>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{result.question}</Body>
          <Sub style={{ marginTop: 8 }}>Answer it above and send again.</Sub>
        </View>
      ) : null}
    </Card>
  );
}
