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
