import { getToken } from './token-store';

// Thin fetch wrapper for the TrackDown backend (backend/). Replaces the PostgREST
// client: every call carries the Better Auth bearer token, JSON in, JSON out.

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined>;

/**
 * Minutes to add to UTC for the phone's local time. The backend takes this on every
 * day-shaped route: day boundaries are the user's local midnight, and only the phone
 * knows where that is (docs/agent-brief.md §Engineering rules).
 */
export function tzOffsetMin(at: Date = new Date()): number {
  return -at.getTimezoneOffset();
}

let onUnauthorized: (() => void) | null = null;
/** lib/auth registers itself here so a 401 drops the dead session (avoids an import cycle). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; query?: Query } = {},
): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const payload = (data ?? {}) as { error?: string; issues?: unknown };
    throw new ApiError(res.status, payload.error ?? `Request failed (${res.status}).`, payload.issues);
  }
  return data as T;
}

/** The headers an <Image> needs to fetch `/api/evidence/:id`, which is authenticated. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function evidenceUrl(id: string): string {
  return `${API_URL}/api/evidence/${id}`;
}

/**
 * One frame of an exercise illustration. Authenticated like evidence is — the frames are
 * ours to host, not the internet's — so an <Image> showing one carries `authHeaders()`.
 */
export function exerciseMediaUrl(exerciseId: string, index: number): string {
  return `${API_URL}/api/exercises/${exerciseId}/media/${index}`;
}

export type UploadPart =
  | { name: string; value: string }
  | { name: string; uri: string; filename: string; type: string };

/**
 * multipart/form-data, for `POST /api/log/analyze` — the one endpoint that takes bytes.
 * React Native's FormData accepts `{ uri, name, type }` where the web takes a Blob, and
 * the Content-Type header must be left unset so the runtime can add its own boundary.
 */
export async function upload<T>(path: string, parts: UploadPart[]): Promise<T> {
  const form = new FormData();
  for (const part of parts) {
    if ('value' in part) form.append(part.name, part.value);
    else {
      // The RN FormData file shape; the DOM types do not describe it.
      form.append(part.name, {
        uri: part.uri,
        name: part.filename,
        type: part.type,
      } as unknown as Blob);
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_URL + path, { method: 'POST', headers, body: form });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const payload = (data ?? {}) as { error?: string; issues?: unknown };
    throw new ApiError(res.status, payload.error ?? `Upload failed (${res.status}).`, payload.issues);
  }
  return data as T;
}
