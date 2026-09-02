import { createAuthClient } from 'better-auth/react';

import { API_URL, setUnauthorizedHandler } from './api';
import { clearToken, getToken, setToken } from './token-store';
import { looksHuman } from './errors';

// Better Auth client, replacing supabase.auth. The backend enables the `bearer` plugin,
// so the session token travels in an Authorization header (returned once in the
// `set-auth-token` response header at sign-in) instead of a cookie.
//
// v1 signed in with a 6-digit emailed code; v2 uses email + password because there is no
// SMTP server (backend/src/auth.ts). Sign-up auto-signs in, so both calls end with a
// session. Forgot your password? An operator runs `npm run reset-password` on the host —
// there is no self-service reset until mail works.

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    auth: { type: 'Bearer', token: () => getToken() ?? '' },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token');
      if (token) setToken(token);
    },
  },
});

/**
 * What a sign-in failure says. Better Auth's own messages are written for people
 * ("Invalid email or password") and are worth showing — but they come off a server, and no
 * server message is rendered in this app without passing the same guard as every other one:
 * anything shaped like JSON, a status or an id becomes the generic line instead
 * (lib/errors.ts §looksHuman).
 */
function authLine(message: string | undefined): string | null {
  if (!message) return null;
  return looksHuman(message) ? message : 'Could not sign you in just now — try again.';
}

/** Must match `MIN_PASSWORD_LENGTH` in backend/src/auth.ts. */
export const MIN_PASSWORD_LENGTH = 8;

/** Sign in to an existing account. `useSession` updates on success. */
export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await authClient.signIn.email({ email, password });
  return { error: authLine(error?.message) };
}

/** Create an account. Better Auth signs the new user in straight away. */
export async function signUp(email: string, password: string): Promise<{ error: string | null }> {
  // `name` is required by Better Auth and unused by any screen; the address is the
  // only thing we know about a brand-new user.
  const { error } = await authClient.signUp.email({ email, password, name: email.split('@')[0] });
  return { error: authLine(error?.message) };
}

/** Revoke the session on the backend, then forget the token locally either way. */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch (error) {
    console.error('Backend sign-out failed, clearing local session anyway:', error);
  }
  clearToken();
  authClient.$store.notify('$sessionSignal');
}

/** Called by the API client when the backend answers 401: the token is dead. */
export function handleUnauthorized(): void {
  clearToken();
  authClient.$store.notify('$sessionSignal');
}

export type Session = { user: { id: string; email: string; name: string } };

/** Same shape the screens consumed from the Supabase version. */
export function useSession(): { session: Session | null; loading: boolean } {
  const { data, isPending } = authClient.useSession();
  return {
    session: data ? { user: { id: data.user.id, email: data.user.email, name: data.user.name } } : null,
    loading: isPending,
  };
}

setUnauthorizedHandler(handleUnauthorized);
