import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ConfirmCard, notedFactsLine, sourcesLine } from '@/components/confirm-card';
import type { ActivityItem, FusionResult } from '@/lib/types';

// The confirm card has to render every kind the classifier can return — that is the whole
// of "confirm, don't trust" (concept-v2 §Principles 3). A kind it cannot draw is a log the
// user cannot save.
//
// And it has to render every one of them READ-ONLY. NO FORMS is a product law (concept-v2
// §Principles 7, user decision 2026-08-31): a correction is told through the input, never
// typed into a field, so the one thing that must never come back to this component is a
// TextInput.

const noop = () => {};

function show(result: FusionResult, onChange: (next: FusionResult) => void = noop) {
  return render(<ConfirmCard result={result} onChange={onChange} />);
}

const activities: FusionResult = {
  kind: 'activities',
  items: [
    {
      exercise: 'Shoulder Press',
      equipment: null,
      description: '3 × 10 shoulder press at 40 lb',
      category: null,
      muscle_groups: null,
      sets: 3,
      reps: 10,
      load_lb: 40,
      duration_min: null,
      distance_mi: null,
      kcal: 90,
      confidence: 'high',
      sources: { exercise: 'photo', sets: 'text', reps: 'text', load_lb: 'photo', kcal: null },
    },
  ],
};

const meal: FusionResult = {
  kind: 'meal',
  description: 'Chicken, rice and broccoli',
  meal_type: 'dinner',
  kcal: 620,
  protein_g: 45,
  carbs_g: 60,
  fat_g: 18,
  fiber_g: 6,
  items: [],
  confidence: 'medium',
  sources: { description: 'photo', kcal: 'photo', protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
};

const weight: FusionResult = {
  kind: 'weight',
  weight_lb: 181.4,
  confidence: 'high',
  sources: { weight_lb: 'photo' },
};

const goal: FusionResult = {
  kind: 'goal',
  spec: {
    kind: 'lose_fat',
    title: 'Get to 170 lb',
    metrics: [{ measure: 'body_weight', target: 170, unit: 'lb', direction: 'decrease', by: '2027-01-14', scope: null, rate: null }],
    active_from: null,
    active_to: null,
  },
  proposed_timeline: {
    by: '2027-01-14',
    rate: 'about 0.75% a week',
    note: 'about 20 weeks at a standard pace',
    realistic: true,
  },
};

describe('ConfirmCard', () => {
  it('renders an exercise with its numbers as text and its sources', () => {
    show(activities);
    expect(screen.getByText('Recognized · exercise')).toBeTruthy();
    expect(screen.getByText('Shoulder Press')).toBeTruthy();
    expect(screen.getByTestId('activity-sets-0')).toHaveTextContent('3');
    expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('10');
    expect(screen.getByTestId('activity-load-0')).toHaveTextContent('40');
    expect(screen.getByText(/from the photo/)).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('leaves out the facts nobody read, rather than drawing a blank field', () => {
    show(activities);
    // Minutes and miles are null on a shoulder press: an empty box invites typing into it.
    expect(screen.queryByText('MINUTES')).toBeNull();
    expect(screen.queryByText('MILES')).toBeNull();
  });

  it('renders a meal with its slot and macros', () => {
    show(meal);
    expect(screen.getByText('Recognized · meal')).toBeTruthy();
    expect(screen.getByTestId('meal-kcal')).toHaveTextContent('620');
    expect(screen.getByTestId('meal-slot')).toHaveTextContent('Dinner');
  });

  it('renders a weigh-in', () => {
    show(weight);
    expect(screen.getByText('Recognized · weight')).toBeTruthy();
    expect(screen.getByTestId('weight-lb')).toHaveTextContent('181.4');
  });

  it('renders a goal with its proposed timeline and the date choices', () => {
    render(<ConfirmCard result={goal} onDateChoice={noop} />);
    expect(screen.getByText('Recognized · goal')).toBeTruthy();
    expect(screen.getByText(/about 20 weeks/)).toBeTruthy();
    expect(screen.getByText('Use 2027-01-14')).toBeTruthy();
    expect(screen.getByText('Keep my date')).toBeTruthy();
    expect(screen.getByText('No date')).toBeTruthy();
    // Nothing was stated alongside it, so there is nothing to note.
    expect(screen.queryByTestId('goal-noted-facts')).toBeNull();
  });

  it('shows the facts stated alongside a goal, which the server is about to save', () => {
    show({
      ...goal,
      facts: { current_weight_lb: 212, training_days: 4, environment: 'gym', age_years: 45 },
    } as FusionResult);
    expect(screen.getByTestId('goal-noted-facts')).toBeTruthy();
    expect(screen.getByText('Also noting: 212 lb today · 4 days/week · gym · 45 years old')).toBeTruthy();
  });

  it('notes only what was actually stated', () => {
    expect(notedFactsLine(null)).toBeNull();
    expect(
      notedFactsLine({ current_weight_lb: null, training_days: null, environment: null, age_years: null }),
    ).toBeNull();
    expect(
      notedFactsLine({ current_weight_lb: null, training_days: 4, environment: null, age_years: null }),
    ).toBe('Also noting: 4 days/week');
  });

  it.each([
    ['constraint', 'A constraint'],
    ['preference', 'A preference'],
    ['coach_context', 'Context for the coach'],
  ] as const)('renders a %s statement in the words that were said', (kind, heading) => {
    show({ kind, text: 'Bad left knee', ...(kind === 'coach_context' ? {} : { fields: null }) } as FusionResult);
    expect(screen.getByText(heading)).toBeTruthy();
    // Quoted, because they are the user's words and not a value in a box.
    expect(screen.getByTestId('statement-text')).toHaveTextContent('“Bad left knee”');
  });

  it('shows the question when the classifier could not tell', () => {
    show({ kind: 'unclear', question: 'Was that the machine or free weights?' });
    expect(screen.getByText('Recognized · unclear')).toBeTruthy();
    expect(screen.getByText('Was that the machine or free weights?')).toBeTruthy();
  });

  it('offers an ✕ only when the screen gave it one to offer', () => {
    const onRemove = jest.fn();
    const { rerender } = render(<ConfirmCard result={weight} />);
    expect(screen.queryByTestId('confirm-card-remove')).toBeNull();

    rerender(<ConfirmCard result={weight} onRemove={onRemove} />);
    fireEvent.press(screen.getByTestId('confirm-card-remove'));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('sourcesLine', () => {
  it('says which facts came from where, and nothing about fields nobody read', () => {
    expect(sourcesLine({ exercise: 'photo', load_lb: 'photo', sets: 'text', kcal: null })).toBe(
      'exercise, load from the photo · sets from your words',
    );
    expect(sourcesLine({ kcal: null })).toBeNull();
    expect(sourcesLine(null)).toBeNull();
  });
});

// The machine is its own fact (migration 0012), and the chip that upgrades a guessed
// movement is an offer rather than a question — the one tap on this card that changes a
// value, and the only one, because it is a tap and not a keyboard.
describe('the machine, and the offer to name the movement', () => {
  it('shows the machine as the sub-line', () => {
    render(
      <ConfirmCard
        result={{
          ...activities,
          items: [{ ...(activities as { items: ActivityItem[] }).items[0]!, equipment: 'cable stack' }],
        }}
      />,
    );
    expect(screen.getByTestId('activity-equipment-line-0')).toHaveTextContent('cable stack');
  });

  it('offers the catalogue name in one tap, and never blocks the save', () => {
    const onChange = jest.fn();
    const guessed: FusionResult = {
      kind: 'activities',
      items: [
        {
          ...(activities as { items: ActivityItem[] }).items[0]!,
          exercise: 'inclined machine chest pull',
          equipment: 'incline bench row machine',
          confidence: 'low',
          refine: { question: 'Was it a Chest-Supported Row?', exercise: 'Chest-Supported Row' },
        },
      ],
    };
    render(<ConfirmCard result={guessed} onChange={onChange} />);

    fireEvent.press(screen.getByTestId('activity-refine-0'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ exercise: 'Chest-Supported Row', refine: null })],
      }),
    );
  });

  it('draws no chip when the movement is already the one it would suggest', () => {
    const named: FusionResult = {
      kind: 'activities',
      items: [
        {
          ...(activities as { items: ActivityItem[] }).items[0]!,
          exercise: 'Chest-Supported Row',
          refine: { question: 'Was it a Chest-Supported Row?', exercise: 'Chest-Supported Row' },
        },
      ],
    };
    render(<ConfirmCard result={named} onChange={noop} />);
    expect(screen.queryByTestId('activity-refine-0')).toBeNull();
  });
});
