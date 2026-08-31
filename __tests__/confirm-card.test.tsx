import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ConfirmCard, notedFactsLine, sourcesLine } from '@/components/confirm-card';
import type { FusionResult } from '@/lib/types';

// The confirm card has to render every kind the classifier can return — that is the whole
// of "confirm, don't trust" (concept-v2 §Principles 3). A kind it cannot draw is a log the
// user cannot save.

const noop = () => {};

function show(result: FusionResult, onChange: (next: FusionResult) => void = noop) {
  return render(<ConfirmCard result={result} onChange={onChange} onSave={noop} onAddMore={noop} />);
}

const activities: FusionResult = {
  kind: 'activities',
  items: [
    {
      exercise: 'Shoulder Press',
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
  it('renders an exercise with its fields and its sources', () => {
    show(activities);
    expect(screen.getByText('Recognized · exercise')).toBeTruthy();
    expect(screen.getByText('Shoulder Press')).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(screen.getByDisplayValue('40')).toBeTruthy();
    expect(screen.getByText(/from the photo/)).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('renders a meal and reports an edit', () => {
    const onChange = jest.fn();
    show(meal, onChange);
    expect(screen.getByText('Recognized · meal')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('meal-kcal'), '700');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'meal', kcal: 700 }));
  });

  it('renders a weigh-in', () => {
    show(weight);
    expect(screen.getByText('Recognized · weight')).toBeTruthy();
    expect(screen.getByDisplayValue('181.4')).toBeTruthy();
  });

  it('renders a goal with its proposed timeline and the date choices', () => {
    show(goal);
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
  ] as const)('renders a %s statement', (kind, heading) => {
    show({ kind, text: 'Bad left knee', ...(kind === 'coach_context' ? {} : { fields: null }) } as FusionResult);
    expect(screen.getByText(heading)).toBeTruthy();
    expect(screen.getByDisplayValue('Bad left knee')).toBeTruthy();
  });

  it('shows the question when the classifier could not tell, and offers no Save', () => {
    show({ kind: 'unclear', question: 'Was that the machine or free weights?' });
    expect(screen.getByText('Recognized · unclear')).toBeTruthy();
    expect(screen.getByText('Was that the machine or free weights?')).toBeTruthy();
    expect(screen.queryByTestId('confirm-save')).toBeNull();
  });

  it('saves and adds more through the two buttons', () => {
    const onSave = jest.fn();
    const onAddMore = jest.fn();
    render(<ConfirmCard result={weight} onChange={noop} onSave={onSave} onAddMore={onAddMore} />);
    fireEvent.press(screen.getByTestId('confirm-save'));
    fireEvent.press(screen.getByTestId('confirm-add-more'));
    expect(onSave).toHaveBeenCalled();
    expect(onAddMore).toHaveBeenCalled();
  });

  // One card is one part of a log. In a stack the Log sheet draws the single Save below
  // them, and each card carries its own ✕ instead.
  it('hides its own buttons when the sheet is drawing one Save for a stack', () => {
    render(<ConfirmCard result={weight} onChange={noop} onSave={noop} onAddMore={noop} showActions={false} />);
    expect(screen.queryByTestId('confirm-save')).toBeNull();
    expect(screen.queryByTestId('confirm-add-more')).toBeNull();
  });

  it('offers an ✕ only when there is something to drop it from', () => {
    const onRemove = jest.fn();
    const { rerender } = render(<ConfirmCard result={weight} onChange={noop} onSave={noop} onAddMore={noop} />);
    expect(screen.queryByTestId('confirm-card-remove')).toBeNull();

    rerender(
      <ConfirmCard result={weight} onChange={noop} onSave={noop} onAddMore={noop} onRemove={onRemove} />,
    );
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
