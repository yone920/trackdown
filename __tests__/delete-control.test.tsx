import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { DeleteControl, DELETE_ARM_MS, dismissDeletes, Row } from '@/components/kit';

// The morphing delete control (components/kit.tsx). Reported 2026-08-31: the old
// "Delete? ✓ ✕" put three targets in a thumb's width, two of which looked alike and meant
// opposite things. There is now one target at a time, and every way out of the armed state
// is something other than a button beside the confirm one.

describe('DeleteControl', () => {
  it('is one ✕ at rest and one wide pill armed — never both, never three', () => {
    const onDelete = jest.fn();
    render(<DeleteControl label="Bench Press" onDelete={onDelete} testID="del" />);

    expect(screen.getByLabelText('Delete Bench Press')).toBeTruthy();
    expect(screen.queryByText('Delete?')).toBeNull();

    fireEvent.press(screen.getByTestId('del'));
    // The ✕ is gone: the pill is in its place and is the only thing there.
    expect(screen.queryByTestId('del')).toBeNull();
    expect(screen.getByText('Delete?')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('del-confirm'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    // And it is back to being an ✕, so a second delete is another two taps.
    expect(screen.getByTestId('del')).toBeTruthy();
  });

  it('gives up after three seconds', () => {
    jest.useFakeTimers();
    try {
      render(<DeleteControl label="a meal" onDelete={jest.fn()} testID="del" />);
      fireEvent.press(screen.getByTestId('del'));
      expect(screen.getByText('Delete?')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(DELETE_ARM_MS + 10);
      });
      expect(screen.queryByText('Delete?')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('is put back by anything happening elsewhere — a scroll, a tap, another row', () => {
    const onDelete = jest.fn();
    render(<DeleteControl label="a meal" onDelete={onDelete} testID="del" />);
    fireEvent.press(screen.getByTestId('del'));

    act(() => dismissDeletes());
    expect(screen.queryByText('Delete?')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('never leaves two questions open at once', () => {
    render(
      <>
        <DeleteControl label="one" onDelete={jest.fn()} testID="one" />
        <DeleteControl label="two" onDelete={jest.fn()} testID="two" />
      </>,
    );
    fireEvent.press(screen.getByTestId('one'));
    fireEvent.press(screen.getByTestId('two'));
    expect(screen.getAllByText('Delete?')).toHaveLength(1);
    expect(screen.getByTestId('one')).toBeTruthy();
  });

  it('is disarmed by the row it sits in being opened for a correction', () => {
    const onPress = jest.fn();
    render(<Row title="Bench Press" onPress={onPress} onDelete={jest.fn()} testID="row" />);

    fireEvent.press(screen.getByTestId('row-delete'));
    expect(screen.getByText('Delete?')).toBeTruthy();

    fireEvent.press(screen.getByTestId('row-open'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.queryByText('Delete?')).toBeNull();
  });
});

// ── the clock column ─────────────────────────────────────────────────────────────────
// Field report 2026-09-01, with a screenshot: "why is this space here?". Every `Row` drew
// a 50 pt column for the time stamp, including on the coach's plan, its finisher and the
// goal history — none of which have a clock in them. The column belongs to lists that
// keep times, and a list says so by passing the prop at all.

/** The widths of every view in the tree — the gutter is the only 50 pt one in a Row. */
function widths(tree: unknown): number[] {
  const found: number[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const element = node as { props?: { style?: unknown }; children?: unknown[] };
    const style = element.props?.style;
    const styles = Array.isArray(style) ? style : [style];
    for (const entry of styles) {
      const width = (entry as { width?: unknown } | null | undefined)?.width;
      if (typeof width === 'number') found.push(width);
    }
    for (const child of element.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}

describe('Row and its clock column', () => {
  it('reserves the 50 pt gutter for a row that keeps a time', () => {
    const view = render(<Row time="8:10a" title="Bench Press" />);
    expect(widths(view.toJSON())).toContain(50);
    expect(screen.getByText('8:10a')).toBeTruthy();
  });

  it('keeps the gutter, empty, for a timed list whose row has no stamp', () => {
    // `null` is how a list that IS timed says this one row has nothing to show: the times
    // above and below it have to stay in line.
    expect(widths(render(<Row time={null} title="Bench Press" />).toJSON())).toContain(50);
  });

  it('draws no gutter at all when the list has no clock in it', () => {
    // The coach's plan, its finisher, the goal history.
    expect(widths(render(<Row title="Doorway Chest Stretch" sub="2 min" />).toJSON())).not.toContain(50);
  });
});
