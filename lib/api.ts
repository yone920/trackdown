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
    /** The server's machine-readable reason, when it named one ("provider_overloaded"). */
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// What a failure SAYS is not this file's business any more: one busy-provider sentence
// lived here, which is exactly the piecemeal shape that let the next status through
// untranslated. Every error line in the app now comes from `lib/errors.ts`, by code.

type Query = Record<string, string | number | boolean | undefined>;

/**
 * How long a request may take before the app gives up on it.
 *
 * There was no explicit timeout here, which does NOT mean there was none: the platform
 * supplies one, and on iOS `NSURLSession` gives up at **60 seconds**. That is shorter than a
 * coach brief takes to write on a phone connection, and it is why a generation that
 * SUCCEEDED on the server came back to the app as a network error (field report
 * 2026-09-02: "Thinking…" then silently nothing, with the plan sitting on the server).
 *
 * So the ceiling is explicit now, and long calls say how long they need. A number the app
 * chooses is a number the app can reason about; a platform default is a number it finds out
 * about in a screenshot.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * No cookies, ever — on any request this app makes.
 *
 * This is a **bearer-token** client: the session arrives once in `set-auth-token` and goes
 * back in `Authorization`. A cookie has never carried anything we read. But iOS's
 * `NSURLSession` keeps a cookie jar per app and replays it automatically, so a cookie the
 * server set for its own reasons rides along on every later request without the app ever
 * asking for it — and on 2026-09-03 that jar locked a TestFlight user out of the app
 * entirely: a cookie planted during failed sign-in attempts made every retry look
 * cookie-bearing, which was the one shape the server's origin gate would not relax for.
 * The device could not clear it short of a reinstall.
 *
 * The server no longer depends on this (backend app.ts §normaliseNativeAuthRequest reads
 * the shape instead), and this is the other half: a jar that is never sent cannot lock
 * anybody out of anything. Cookies here are pure liability, so we decline them.
 */
const CREDENTIALS: RequestCredentials = 'omit';

/** A generation is a model call over a phone connection. It is allowed to take its time. */
export const GENERATE_TIMEOUT_MS = 180_000;

/** What a timeout throws, so a caller can tell "slow" from "refused". */
export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super('That took too long to come back.');
    this.name = 'TimeoutError';
  }
}

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
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    query?: Query;
    /** Overrides {@link DEFAULT_TIMEOUT_MS}. A generation passes {@link GENERATE_TIMEOUT_MS}. */
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const ms = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const res = await withTimeout(
    (signal) =>
      fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
        credentials: CREDENTIALS,
      }),
    ms,
  );

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
    const payload = (data ?? {}) as { error?: string; issues?: unknown; code?: string };
    throw new ApiError(
      res.status,
      payload.error ?? `Request failed (${res.status}).`,
      payload.issues,
      payload.code,
    );
  }
  return data as T;
}

/**
 * One fetch, with a deadline the app chose. An abort is reported as {@link TimeoutError}
 * rather than as the runtime's own `AbortError`, because "we stopped waiting" and "the
 * network refused" lead to different recoveries and the caller has to be able to tell them
 * apart.
 */
async function withTimeout(run: (signal: AbortSignal) => Promise<Response>, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new TimeoutError(ms);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The headers an <Image> needs to fetch `/api/evidence/:id`, which is authenticated. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function evidenceUrl(id: string): string {
  return `${API_URL}/api/evidence/${id}`;
}

/** How wide a frame is asked for. The server serves these three and 400s anything else. */
export type ExerciseMediaWidth = 320 | 640 | 1280;

/**
 * The width the sheet's stacked photographs ask for. They are drawn full-width at 4:3 on a
 * phone, so 640 is retina on every device this ships to and roughly a fifth of the bytes of
 * the dataset's original (field report 2026-09-01: the sheet was slow on one bar).
 */
export const SHEET_PHOTO_WIDTH: ExerciseMediaWidth = 640;

/** Anything drawn as a small tile. A 160 px box does not need more than 320 px of picture. */
export const THUMB_PHOTO_WIDTH: ExerciseMediaWidth = 320;

/**
 * One frame of an exercise illustration. Authenticated like evidence is — the frames are
 * ours to host, not the internet's — so an <Image> showing one carries `authHeaders()`.
 *
 * `width` is part of the URL and therefore part of the cache key, on the disk cache and in
 * `Image.prefetch` both: a prefetch at 640 only warms the tap that also asks for 640.
 * Omitting it asks for the original, which is what the full-screen zoom wants.
 */
export function exerciseMediaUrl(
  exerciseId: string,
  index: number,
  width?: ExerciseMediaWidth,
): string {
  const query = width ? `?w=${width}` : '';
  return `${API_URL}/api/exercises/${exerciseId}/media/${index}${query}`;
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

  const res = await fetch(API_URL + path, { method: 'POST', headers, body: form, credentials: CREDENTIALS });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const payload = (data ?? {}) as { error?: string; issues?: unknown; code?: string };
    throw new ApiError(
      res.status,
      payload.error ?? `Upload failed (${res.status}).`,
      payload.issues,
      payload.code,
    );
  }
  return data as T;
}
