// What a failure LOOKS like, in one place.
//
// The rule, from the user, after two days of field reports: **errors do not propagate to
// users.** Not the provider's JSON, not a status code, not a request id, not a stack line —
// on 2026-09-02 a 529 was printed under the input box, and the day after, once that one
// status had been humanised by name, a 400 saying "Your credit balance is too low" was
// printed in the same place. Naming statuses is a game you lose one at a time.
//
// So the app renders **by code**, from a closed table, and anything it does not recognise
// gets the generic line. That is the whole policy, and it is deliberately blunt: an error
// shape nobody anticipated is exactly the case where raw text is most likely to be
// developer talk, so the unknown branch must be the safe one rather than the passthrough.
// The server has the matching table (backend/src/services/llmErrors.ts) and sends the code;
// this table exists so a phone whose server is older, newer, or unreachable still speaks
// English.
//
// Copy per code, and why they differ: a busy reader is worth trying again in seconds; a
// reader that is down is worth trying later and is worth promising that the words are kept;
// an unusable answer is nobody's fault and worth one plain retry.

export type ReaderCode = 'provider_overloaded' | 'reader_unavailable' | 'reader_failed';

export const READER_MESSAGE: Record<ReaderCode, string> = {
  provider_overloaded: 'The reader is busy right now — try again in a few seconds.',
  reader_unavailable: 'The reader is down right now. Your words are kept — try again in a bit.',
  reader_failed: "That didn't get read. Nothing was lost — try again.",
};

/** The line for anything unrecognised. Blames nobody and promises nothing that is not true. */
export const GENERIC_MESSAGE = READER_MESSAGE.reader_failed;

/** What the app says when it could not reach its own server at all. */
export const OFFLINE_MESSAGE = 'Could not reach the server — check your connection and try again.';

function isReaderCode(code: string | undefined): code is ReaderCode {
  return code === 'provider_overloaded' || code === 'reader_unavailable' || code === 'reader_failed';
}

/**
 * Statuses whose body is written by OUR OWN routes about the request itself — "At most 6
 * photos per log.", "Send a photo or say something first.", "Could not understand that."
 *
 * These are the one case where the server's sentence is worth showing: it names something
 * the user can actually change, and replacing it with "that didn't get read" would hide a
 * fixable problem behind a shrug. Everything else — 5xx, a status with no body, a thrown
 * object of unknown shape — is rendered from the table.
 */
const CLIENT_ERROR_STATUSES = new Set([400, 409, 413, 415, 422]);

/**
 * Does this read like a sentence written for a person?
 *
 * A guard, not a parser. Provider prose arrives wrapped in JSON, carrying a request id or
 * led by a bare status, and any of those disqualifies a string no matter which status it
 * came under — belt and braces, so that a route that starts forwarding an SDK message under
 * a 400 tomorrow still cannot reach a screen.
 */
export function looksHuman(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 160) return false;
  if (/[{}[\]]|"[a-z_]+"\s*:/.test(trimmed)) return false;
  if (/request_id|req_[A-Za-z0-9]{6}|_error\b|stack|Error:/i.test(trimmed)) return false;
  if (/^\s*\d{3}\b/.test(trimmed)) return false;
  return true;
}

/**
 * The line to show for a failed call. One function, used by every screen that has an error
 * line, so there is no second place where a policy could quietly differ.
 *
 * `fallback` is the caller's own sentence for the action that failed ("Could not make that
 * change.") — used only where the failure is otherwise unattributable, never to print
 * something the server said.
 */
export function readerLine(error: unknown, fallback: string = GENERIC_MESSAGE): string {
  // A timeout is the app's own sentence and already says the useful thing.
  if (named(error) === 'TimeoutError' && typeof (error as Error).message === 'string') {
    return (error as Error).message;
  }

  const failure = asServerFailure(error);
  if (failure) {
    if (isReaderCode(failure.code)) return READER_MESSAGE[failure.code];
    // An older server, or a route that has not learnt the codes: 503 is the status that
    // means "come back later", and it is what the busy path used before there were codes.
    if (failure.status === 503) return READER_MESSAGE.provider_overloaded;
    if (failure.status >= 500) return READER_MESSAGE.reader_failed;
    if (CLIENT_ERROR_STATUSES.has(failure.status) && looksHuman(failure.message)) return failure.message;
    return fallback;
  }

  // Not a server answer at all: a network refusal, a bug, something thrown that is not an
  // Error. None of those has a message worth printing.
  return fallback;
}

/** True when the reader is merely busy — the only failure worth suggesting "in a few seconds". */
export function isBusy(error: unknown): boolean {
  const failure = asServerFailure(error);
  return !!failure && (failure.code === 'provider_overloaded' || failure.status === 503);
}

/**
 * A thrown thing, read as "the server answered with a failure" — by SHAPE, not by class.
 *
 * Deliberately not `instanceof ApiError`: class identity is the one thing that does not
 * survive a jest module mock, a second copy of a module in a bundle, or an error that
 * crossed a serialisation boundary — and an identity check that quietly fails would send
 * every failure down the unknown branch, which is where this policy is least specific. A
 * numeric `status` is what actually makes an answer a server's.
 */
function asServerFailure(error: unknown): { status: number; code?: string; message: string } | null {
  if (error === null || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof candidate.status !== 'number') return null;
  return {
    status: candidate.status,
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    message: typeof candidate.message === 'string' ? candidate.message : '',
  };
}

function named(error: unknown): string | undefined {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : undefined;
}
