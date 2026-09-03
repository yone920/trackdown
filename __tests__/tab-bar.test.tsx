import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { TabBar } from '@/components/tab-bar';

// The floating `+` and the framing it carries (lib/log-framing.ts).
//
// A tab about one thing is a door that knows something. Pressing + while looking at what you
// ate used to open the sheet suggesting a shoulder press — the same mistake the You page made
// (field report 2026-09-03: "if it is being called from food it should say how to log lunch").

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

const ROUTES = ['index', 'train', 'eat', 'progress'];

function renderBar(focused: string) {
  const state = {
    index: ROUTES.indexOf(focused),
    routes: ROUTES.map((name) => ({ key: `${name}-key`, name })),
  };
  const navigation = { emit: () => ({ defaultPrevented: false }), navigate: jest.fn() };
  const props = { state, navigation, descriptors: {}, insets: { top: 0, bottom: 0, left: 0, right: 0 } };
  return render(<TabBar {...(props as unknown as React.ComponentProps<typeof TabBar>)} />);
}

beforeEach(() => mockPush.mockReset());

describe('the floating +', () => {
  it('opens on the plate from Eat', () => {
    renderBar('eat');
    fireEvent.press(screen.getByTestId('log-fab'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { framing: 'food' } });
  });

  it('opens on the set from Train', () => {
    renderBar('train');
    fireEvent.press(screen.getByTestId('log-fab'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { framing: 'workout' } });
  });

  // Home thinks in whole days and Progress in the long view: neither implies a register, and
  // the default is now three examples wide rather than a workout.
  it('says nothing from the tabs that imply nothing', () => {
    renderBar('index');
    fireEvent.press(screen.getByTestId('log-fab'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log' });

    mockPush.mockReset();
    renderBar('progress');
    fireEvent.press(screen.getByTestId('log-fab'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log' });
  });
});
