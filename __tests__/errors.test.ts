import { GENERIC_MESSAGE, isBusy, looksHuman, readerLine, READER_MESSAGE } from '@/lib/errors';

// The app's half of the error policy (backend/src/services/llmErrors.ts is the other).
//
// The rule this file exists to hold: **no error text the app did not write ever reaches a
// screen** — except a sentence one of our own routes wrote about the request itself. Two
// field reports on consecutive days put a provider's JSON under the input box, the second
// one after the first status had been humanised by name, which is why the unknown branch
// here is the safe line and not the passthrough.

/** What `lib/api.ts` throws, in the shape the policy actually reads: a numeric status. */
const failure = (status: number, message: string, code?: string) =>
  Object.assign(new Error(message), { name: 'ApiError', status, ...(code ? { code } : {}) });

describe('the line a failure gets', () => {
  it('renders by code, whatever prose came with it', () => {
    expect(readerLine(failure(503, '529 {"type":"error"}', 'provider_overloaded'))).toBe(
      READER_MESSAGE.provider_overloaded,
    );
    expect(readerLine(failure(503, 'Your credit balance is too low', 'reader_unavailable'))).toBe(
      READER_MESSAGE.reader_unavailable,
    );
    expect(readerLine(failure(502, 'model returned no structured output', 'reader_failed'))).toBe(
      READER_MESSAGE.reader_failed,
    );
  });

  it.each([
    ['a thrown string', 'kaboom'],
    ['a thrown object', { weird: true }],
    ['null', null],
    ['undefined', undefined],
    ['a plain Error', new Error('TypeError: x is not a function')],
    ['an unknown code on a 500', failure(500, '400 {"type":"error","error":{"type":"invalid_request_error"}}', 'new_code')],
    ['a 500 with no body', failure(500, 'Request failed (500).')],
  ])('gives %s the generic line and prints none of it', (_name, thrown) => {
    const line = readerLine(thrown, GENERIC_MESSAGE);
    expect(line).toBe(GENERIC_MESSAGE);
    expect(line).not.toMatch(/kaboom|TypeError|invalid_request_error|\{|500|new_code/);
  });

  it('uses the caller’s own sentence when the failure says nothing usable', () => {
    expect(readerLine(new Error('network down'), 'Could not make that change.')).toBe(
      'Could not make that change.',
    );
    expect(readerLine(failure(404, 'Not found.'), 'Could not make that change.')).toBe(
      'Could not make that change.',
    );
  });

  // Our own routes write these, and they name something the user can act on.
  it('keeps a sentence our own server wrote about the request', () => {
    expect(readerLine(failure(422, 'Could not understand that.'))).toBe('Could not understand that.');
    expect(readerLine(failure(413, 'Each photo must be under 8 MB.'))).toBe('Each photo must be under 8 MB.');
  });

  // Belt and braces: even under a status whose prose is normally shown, anything shaped
  // like machine output is refused.
  it('refuses machine-shaped text even on a status whose prose it trusts', () => {
    const line = readerLine(failure(400, '400 {"type":"error","error":{"message":"nope"},"request_id":"req_011abc"}'));
    expect(line).toBe(GENERIC_MESSAGE);
  });

  it('keeps a timeout’s own words — the app wrote them', () => {
    const timeout = Object.assign(new Error('That took too long to come back.'), { name: 'TimeoutError' });
    expect(readerLine(timeout)).toBe('That took too long to come back.');
  });

  it('never carries a status, an id or a brace in any line it can produce', () => {
    for (const message of Object.values(READER_MESSAGE)) {
      expect(message).not.toMatch(/\d{3}|request_id|req_|\{|\}|"|http/i);
    }
  });
});

describe('looksHuman', () => {
  it('accepts a sentence and refuses machine output', () => {
    expect(looksHuman('Could not understand that.')).toBe(true);
    expect(looksHuman('Invalid email or password')).toBe(true);
    expect(looksHuman('{"type":"error"}')).toBe(false);
    expect(looksHuman('529 Overloaded')).toBe(false);
    expect(looksHuman('request_id=req_011CeewngNS')).toBe(false);
    expect(looksHuman('overloaded_error')).toBe(false);
    expect(looksHuman('')).toBe(false);
    expect(looksHuman(undefined)).toBe(false);
    expect(looksHuman('x'.repeat(200))).toBe(false);
  });
});

describe('isBusy', () => {
  it('is true only for the failure that fixes itself in seconds', () => {
    expect(isBusy(failure(503, '', 'provider_overloaded'))).toBe(true);
    expect(isBusy(failure(503, ''))).toBe(true);
    expect(isBusy(failure(502, '', 'reader_failed'))).toBe(false);
    expect(isBusy(new Error('nope'))).toBe(false);
  });
});
