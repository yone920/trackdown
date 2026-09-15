import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import SignIn from '@/app/(auth)/sign-in';
import { authLine } from '@/lib/errors';

// The one sanctioned form in this app (concept-v2 §Principles 7: everything else is told in
// words), and the first screen anybody sees. Two field reports on the first TestFlight
// build put it here:
//
//   · account creation failed with Better Auth's "Missing or null Origin" printed on it —
//     server prose on the sign-up screen, which is the app-wide rule broken in the one
//     place a stranger meets it first (lib/errors.ts §authLine);
//   · **there is no reset email.** A typo in a password nobody can see is a locked account
//     with no way back, so creating one asks for it twice and either field can be looked at.

const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
jest.mock('@/lib/auth', () => ({
  MIN_PASSWORD_LENGTH: 8,
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signUp: (...args: unknown[]) => mockSignUp(...args),
}));

beforeEach(() => {
  mockSignIn.mockReset().mockResolvedValue({ error: null });
  mockSignUp.mockReset().mockResolvedValue({ error: null });
});

/** Switch to create-account, where the second field lives. */
function createAccount() {
  fireEvent.press(screen.getByTestId('auth-switch-mode'));
}

function type(testID: string, value: string) {
  fireEvent.changeText(screen.getByTestId(testID), value);
}

describe('signing in', () => {
  it('asks for one password, and never a second one', () => {
    render(<SignIn />);
    expect(screen.getByTestId('auth-password')).toBeTruthy();
    // Signing in cannot lock anybody out, so it stays one field.
    expect(screen.queryByTestId('auth-confirm')).toBeNull();
  });

  it('hides the password until the eye is pressed, and hides it again', () => {
    render(<SignIn />);
    const field = () => screen.getByTestId('auth-password');
    expect(field().props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByTestId('auth-password-reveal'));
    expect(field().props.secureTextEntry).toBe(false);

    fireEvent.press(screen.getByTestId('auth-password-reveal'));
    expect(field().props.secureTextEntry).toBe(true);
  });

  it('signs in with what was typed', async () => {
    render(<SignIn />);
    type('auth-password', 'correct-horse-battery');
    fireEvent.changeText(screen.getAllByPlaceholderText('you@example.com')[0]!, 'Ada@Example.com ');
    fireEvent.press(screen.getByTestId('auth-submit'));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('ada@example.com', 'correct-horse-battery'));
  });
});

describe('creating an account', () => {
  it('asks for the password twice, because there is no way to reset it', () => {
    render(<SignIn />);
    createAccount();
    expect(screen.getByTestId('auth-confirm')).toBeTruthy();
  });

  it('refuses a mismatch in a plain line, and never calls the server', async () => {
    render(<SignIn />);
    createAccount();
    fireEvent.changeText(screen.getAllByPlaceholderText('you@example.com')[0]!, 'ada@example.com');
    type('auth-password', 'correct-horse-battery');
    type('auth-confirm', 'correct-horse-battary');
    fireEvent.press(screen.getByTestId('auth-submit'));

    expect(await screen.findByText('Those passwords do not match.')).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('creates the account once both halves agree', async () => {
    render(<SignIn />);
    createAccount();
    fireEvent.changeText(screen.getAllByPlaceholderText('you@example.com')[0]!, 'ada@example.com');
    type('auth-password', 'correct-horse-battery');
    type('auth-confirm', 'correct-horse-battery');
    fireEvent.press(screen.getByTestId('auth-submit'));

    await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith('ada@example.com', 'correct-horse-battery'));
  });

  it('shows both halves at once, so a typo can actually be found', () => {
    render(<SignIn />);
    createAccount();
    expect(screen.getByTestId('auth-password').props.secureTextEntry).toBe(true);
    expect(screen.getByTestId('auth-confirm').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByTestId('auth-confirm-reveal'));
    expect(screen.getByTestId('auth-password').props.secureTextEntry).toBe(false);
    expect(screen.getByTestId('auth-confirm').props.secureTextEntry).toBe(false);
  });

  it('drops the second field when the mode goes back to signing in', () => {
    render(<SignIn />);
    createAccount();
    type('auth-confirm', 'something');
    fireEvent.press(screen.getByTestId('auth-switch-mode'));
    expect(screen.queryByTestId('auth-confirm')).toBeNull();
  });
});

describe('what the screen says when the server refuses', () => {
  it('renders the app’s own line, never the server’s prose', async () => {
    // The exact failure from the first TestFlight build.
    mockSignUp.mockResolvedValue({ error: 'Could not create your account just now — try again.' });
    render(<SignIn />);
    createAccount();
    fireEvent.changeText(screen.getAllByPlaceholderText('you@example.com')[0]!, 'ada@example.com');
    type('auth-password', 'correct-horse-battery');
    type('auth-confirm', 'correct-horse-battery');
    fireEvent.press(screen.getByTestId('auth-submit'));

    expect(await screen.findByTestId('auth-error')).toHaveTextContent(
      'Could not create your account just now — try again.',
    );
    expect(screen.queryByText(/Origin|CSRF|403/)).toBeNull();
  });
});

// The mapping itself, which is what decides whether server prose can ever reach that line.
describe('the auth error table', () => {
  it('says the things a person can act on, by code', () => {
    expect(authLine({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 'in')).toBe("That email and password don't match.");
    expect(authLine({ code: 'USER_ALREADY_EXISTS' }, 'up')).toBe(
      'There is already an account with that email — sign in instead.',
    );
  });

  // "Missing or null Origin" reads like a sentence, which is exactly why a shape guard let
  // it through and why this is by code instead.
  it('gives anything else the generic line for that flow', () => {
    const origin = { code: 'MISSING_OR_NULL_ORIGIN', message: 'Missing or null Origin' };
    expect(authLine(origin, 'up')).toBe('Could not create your account just now — try again.');
    expect(authLine(origin, 'in')).toBe('Could not sign you in just now — try again.');
    expect(authLine({ message: 'something nobody wrote copy for' }, 'in')).toBe(
      'Could not sign you in just now — try again.',
    );
    expect(authLine(null, 'in')).toBeNull();
  });
});
