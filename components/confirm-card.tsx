import { View } from 'react-native';

import { Field, FieldGrid, LineField } from '@/components/fields';
import { Card, Chip, Chips } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { C } from '@/lib/theme';
import type {
  ActivityItem,
  Confidence,
  FieldSource,
  FusionResult,
  GoalFacts,
  ProposedTimeline,
} from '@/lib/types';

// The confirm card (docs/design-system.md §Log). "Confirm, don't trust": every reading is
// shown before it counts, editable in one tap, with what each fact came from and how sure
// the model was (concept-v2 §Principles 3).
//
// It renders *every* kind the classifier can return, including `unclear` — which asks one
// question instead of guessing (backend/src/services/fusion/schema.ts).

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

const num = (value: number | null | undefined): string => (value == null ? '' : String(value));
const toNum = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};
const toInt = (text: string): number | null => {
  const parsed = toNum(text);
  return parsed == null ? null : Math.round(parsed);
};

function ConfidenceChip({ level }: { level: Confidence }) {
  return (
    <View
      style={{
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: CONFIDENCE_COLOR[level],
      }}>
      <Eyebrow style={{ color: CONFIDENCE_COLOR[level], fontSize: 10 }}>{level}</Eyebrow>
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
  dateChoice = 'proposed',
  onDateChoice,
  onSave,
  onAddMore,
  saving = false,
  error,
  saveLabel = 'Save',
  showAddMore = true,
  eyebrow,
}: {
  result: FusionResult;
  onChange: (next: FusionResult) => void;
  dateChoice?: DateChoice;
  onDateChoice?: (choice: DateChoice) => void;
  onSave: () => void;
  onAddMore: () => void;
  saving?: boolean;
  error?: string | null;
  /** "Save changes" when the card is correcting a row that already exists (DayLog). */
  saveLabel?: string;
  /** A correction has nothing to add more of. */
  showAddMore?: boolean;
  /** Overrides "Recognized · <kind>" — a correction was recognized a while ago. */
  eyebrow?: string;
}) {
  const patchActivity = (index: number, patch: Partial<ActivityItem>) => {
    if (result.kind !== 'activities') return;
    const items = result.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...result, items });
  };

  return (
    <Card testID="confirm-card" style={{ marginTop: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Eyebrow>{eyebrow ?? `Recognized · ${KIND_LABEL[result.kind]}`}</Eyebrow>
        {'confidence' in result ? <ConfidenceChip level={result.confidence} /> : null}
      </View>

      {result.kind === 'activities' ? (
        <View>
          {result.items.map((item, index) => (
            <View key={index} style={{ marginTop: index === 0 ? 12 : 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Disp size={22} style={{ flex: 1 }}>
                  {item.exercise ?? item.description}
                </Disp>
                <ConfidenceChip level={item.confidence} />
              </View>
              {sourcesLine(item.sources) ? (
                <Sub style={{ marginTop: 4 }}>{sourcesLine(item.sources)}</Sub>
              ) : null}
              <FieldGrid>
                <Field
                  label="Exercise"
                  width="100%"
                  value={item.exercise ?? ''}
                  onChangeText={(text) => patchActivity(index, { exercise: text || null })}
                  testID={`activity-exercise-${index}`}
                />
                <Field
                  label="Sets"
                  numeric
                  value={num(item.sets)}
                  onChangeText={(text) => patchActivity(index, { sets: toInt(text) })}
                />
                <Field
                  label="Reps"
                  numeric
                  value={num(item.reps)}
                  onChangeText={(text) => patchActivity(index, { reps: toInt(text) })}
                />
                <Field
                  label="Load lb"
                  numeric
                  value={num(item.load_lb)}
                  onChangeText={(text) => patchActivity(index, { load_lb: toNum(text) })}
                />
                <Field
                  label="Minutes"
                  numeric
                  value={num(item.duration_min)}
                  onChangeText={(text) => patchActivity(index, { duration_min: toInt(text) })}
                />
                <Field
                  label="Miles"
                  numeric
                  value={num(item.distance_mi)}
                  onChangeText={(text) => patchActivity(index, { distance_mi: toNum(text) })}
                />
                <Field
                  label="Kcal"
                  numeric
                  value={num(item.kcal)}
                  onChangeText={(text) => patchActivity(index, { kcal: toInt(text) })}
                />
              </FieldGrid>
            </View>
          ))}
        </View>
      ) : null}

      {result.kind === 'meal' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>{result.description}</Disp>
          {sourcesLine(result.sources) ? <Sub style={{ marginTop: 4 }}>{sourcesLine(result.sources)}</Sub> : null}
          <FieldGrid>
            <LineField
              label="What it was"
              value={result.description}
              onChangeText={(text) => onChange({ ...result, description: text })}
              testID="meal-description"
            />
            <Field
              label="Kcal"
              numeric
              value={num(result.kcal)}
              onChangeText={(text) => onChange({ ...result, kcal: toInt(text) })}
              testID="meal-kcal"
            />
            <Field
              label="Protein g"
              numeric
              value={num(result.protein_g)}
              onChangeText={(text) => onChange({ ...result, protein_g: toNum(text) })}
            />
            <Field
              label="Carbs g"
              numeric
              value={num(result.carbs_g)}
              onChangeText={(text) => onChange({ ...result, carbs_g: toNum(text) })}
            />
            <Field
              label="Fat g"
              numeric
              value={num(result.fat_g)}
              onChangeText={(text) => onChange({ ...result, fat_g: toNum(text) })}
            />
            <Field
              label="Fibre g"
              numeric
              value={num(result.fiber_g)}
              onChangeText={(text) => onChange({ ...result, fiber_g: toNum(text) })}
            />
          </FieldGrid>
          {result.items.length > 0 ? (
            <Sub style={{ marginTop: 12 }}>{result.items.map((item) => item.name).join(' · ')}</Sub>
          ) : null}
        </View>
      ) : null}

      {result.kind === 'weight' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>Weigh-in</Disp>
          {sourcesLine(result.sources) ? <Sub style={{ marginTop: 4 }}>{sourcesLine(result.sources)}</Sub> : null}
          <FieldGrid>
            <Field
              label="Weight lb"
              numeric
              width="46%"
              value={num(result.weight_lb)}
              onChangeText={(text) => {
                const parsed = toNum(text);
                if (parsed !== null) onChange({ ...result, weight_lb: parsed });
              }}
              testID="weight-lb"
            />
          </FieldGrid>
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
          <FieldGrid>
            <LineField
              label="Goal"
              value={result.spec.title}
              onChangeText={(text) => onChange({ ...result, spec: { ...result.spec, title: text } })}
              testID="goal-title"
            />
          </FieldGrid>
          {/* The proposal is an offer, not a correction (concept-v2 §Goals). */}
          <View style={{ marginTop: 14 }}>
            <Chips>
              <Chip
                label={result.proposed_timeline?.by ? `Use ${result.proposed_timeline.by}` : 'Use the projection'}
                variant={dateChoice === 'proposed' ? 'primary' : 'secondary'}
                onPress={() => onDateChoice?.('proposed')}
              />
              <Chip
                label="Keep my date"
                variant={dateChoice === 'confirm_date' ? 'primary' : 'secondary'}
                onPress={() => onDateChoice?.('confirm_date')}
              />
              <Chip
                label="No date"
                variant={dateChoice === 'no_date' ? 'primary' : 'secondary'}
                onPress={() => onDateChoice?.('no_date')}
              />
            </Chips>
          </View>
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
          <FieldGrid>
            <LineField
              label="In your words"
              value={result.text}
              onChangeText={(text) => onChange({ ...result, text })}
              testID="statement-text"
            />
          </FieldGrid>
        </View>
      ) : null}

      {result.kind === 'unclear' ? (
        <View style={{ marginTop: 12 }}>
          <Disp size={22}>One question</Disp>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{result.question}</Body>
          <Sub style={{ marginTop: 8 }}>Answer it above and send again.</Sub>
        </View>
      ) : null}

      {error ? <Sub style={{ marginTop: 12, color: C.accent }}>{error}</Sub> : null}

      {result.kind === 'unclear' ? (
        <View style={{ marginTop: 18 }}>
          <Chips>
            <Chip label="Add more" onPress={onAddMore} />
          </Chips>
        </View>
      ) : (
        <View style={{ marginTop: 18 }}>
          <Chips>
            <Chip
              testID="confirm-save"
              label={saving ? 'Saving…' : saveLabel}
              variant="primary"
              onPress={onSave}
              disabled={saving}
            />
            {showAddMore ? (
              <Chip testID="confirm-add-more" label="Add more" onPress={onAddMore} disabled={saving} />
            ) : null}
          </Chips>
        </View>
      )}
    </Card>
  );
}
