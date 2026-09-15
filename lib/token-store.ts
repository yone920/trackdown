import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Where the Better Auth bearer token lives on the device. Supabase kept its session in
// SecureStore too (lib/supabase.ts, now gone); this is the same idea with one string.
// Reads are synchronous so the auth client can attach the token to the very first
// request after launch without an async gate.

const KEY = 'trackdown.session-token';

export function getToken(): string | null {
  if (Platform.OS === 'web') {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
  }
  return SecureStore.getItem(KEY);
}

export function setToken(token: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, token);
    return;
  }
  SecureStore.setItem(KEY, token);
}

export function clearToken(): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.localStorage.removeItem(KEY);
    return;
  }
  // deleteItemAsync is the only removal API; fire-and-forget is fine here
  void SecureStore.deleteItemAsync(KEY);
}
