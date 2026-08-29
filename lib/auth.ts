import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { API_URL, setUnauthorizedHandler } from './api';
import { clearToken, getToken, setToken } from './token-store';

// Better Auth client, replacing supabase.auth. The backend enables the `bearer` plugin,
// so the session token travels in an Authorization header (returned once in the
// `set-auth-token` response header at sign-in) instead of a cookie.

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [emailOTPClient()],
  fetchOptions: {
    auth: { type: 'Bearer', token: () => getToken() ?? '' },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token');
      if (token) setToken(token);
    },
  },
});

/** Step 1 of sign-in: email a 6-digit code (creates the account on first use). */
export async function sendSignInCode(email: string): Promise<{ error: string | null }> {
  const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
  return { error: error?.message ?? null };
}

/** Step 2: exchange the code for a session. `useSession` updates on success. */
export async function verifySignInCode(
  email: string,
  otp: string,
): Promise<{ error: string | null }> {
  const { error } = await authClient.signIn.emailOtp({ email, otp });
  return { error: error?.message ?? null };
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
