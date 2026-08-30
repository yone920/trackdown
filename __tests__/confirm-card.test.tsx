import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ConfirmCard, sourcesLine } from '@/components/confirm-card';
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
    expect(screen.getByText('Recognised · exercise')).toBeTruthy();
    expect(screen.getByText('Shoulder Press')).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(screen.getByDisplayValue('40')).toBeTruthy();
    expect(screen.getByText(/from the photo/)).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('renders a meal and reports an edit', () => {
    const onChange = jest.fn();
    show(meal, onChange);
    expect(screen.getByText('Recognised · meal')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('meal-kcal'), '700');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'meal', kcal: 700 }));
  });

  it('renders a weigh-in', () => {
    show(weight);
    expect(screen.getByText('Recognised · weight')).toBeTruthy();
    expect(screen.getByDisplayValue('181.4')).toBeTruthy();
  });

  it('renders a goal with its proposed timeline and the date choices', () => {
    show(goal);
    expect(screen.getByText('Recognised · goal')).toBeTruthy();
    expect(screen.getByText(/about 20 weeks/)).toBeTruthy();
    expect(screen.getByText('Use 2027-01-14')).toBeTruthy();
    expect(screen.getByText('Keep my date')).toBeTruthy();
    expect(screen.getByText('No date')).toBeTruthy();
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
    expect(screen.getByText('Recognised · unclear')).toBeTruthy();
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
