import { api, DEFAULT_TIMEOUT_MS, GENERATE_TIMEOUT_MS, TimeoutError } from '@/lib/api';

// The deadline the app chose, instead of the one the platform chose for it.
//
// There was no explicit timeout on this wrapper, which did NOT mean there was none: iOS's
// `NSURLSession` gives up at 60 seconds, and that is shorter than a coach brief takes to
// write over a phone connection. A generation that SUCCEEDED on the server came back to the
// app as a network error, and the screen quietly reset (field report 2026-09-02).

jest.mock('@/lib/token-store', () => ({ getToken: () => 'test-token' }));

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

/** A fetch that never settles until the signal aborts, like a request over dead air. */
function hangingFetch() {
  return jest.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
}

describe('the request deadline', () => {
  it('is long enough for a model call, and longer than an ordinary one', () => {
    // The whole bug in two numbers: a generation needs more than the 60s the platform gave.
    expect(GENERATE_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(GENERATE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });

  it('gives up on a request that never comes back, and says which kind of failure it was', async () => {
    jest.useFakeTimers();
    global.fetch = hangingFetch() as unknown as typeof fetch;

    const pending = api('/api/coach/status', { timeoutMs: 1_000 });
    const settled = pending.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(1_000);

    const error = await settled;
    // A TimeoutError, not a bare network error: "we stopped waiting" and "the network
    // refused" lead to different recoveries, and the caller has to tell them apart.
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).ms).toBe(1_000);
  });

  it('waits the whole time it was given before giving up', async () => {
    jest.useFakeTimers();
    global.fetch = hangingFetch() as unknown as typeof fetch;

    let done = false;
    const pending = api('/api/coach/next/regenerate', { timeoutMs: 5_000 }).catch(() => {
      done = true;
    });

    await jest.advanceTimersByTimeAsync(4_999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });

  it('passes a signal to fetch, so a request that is given up on is actually cancelled', async () => {
    jest.useFakeTimers();
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const settled = api('/api/coach/status', { timeoutMs: 500 }).catch(() => null);
    await jest.advanceTimersByTimeAsync(500);
    await settled;

    const init = fetchMock.mock.calls[0]![1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(true);
  });

  it('leaves a request that answers in time completely alone', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ has_plan: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(api('/api/coach/status')).resolves.toEqual({ has_plan: true });
  });
});

// ── the cookie jar this app never asked for ──────────────────────────────────────────
//
// iOS's NSURLSession keeps a cookie jar per app and replays it automatically. Better Auth
// sets a session cookie alongside the bearer token, so that jar filled up on its own — and
// on 2026-09-03 it locked a TestFlight user out entirely: a cookie planted during failed
// sign-in attempts made every retry look cookie-bearing, which was the one shape the
// server's origin gate would not relax for, and nothing but a reinstall could clear it.
//
// The server reads the request's shape now rather than trusting the absence of a cookie
// (backend app.ts §normaliseNativeAuthRequest). This is the other half: a jar that is never
// sent cannot lock anybody out of anything. We are a bearer-token client; cookies here
// carry no authority we read and no protection we lose.

describe('cookies', () => {
  it('are never sent — the token is the session, and the jar is liability', async () => {
    const sent = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{}',
    });
    global.fetch = sent as unknown as typeof fetch;

    await api('/api/week');

    expect(sent).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit' }));
    // And the session still travels the way it always has.
    expect(sent.mock.calls[0]![1].headers.Authorization).toBe('Bearer test-token');
  });
});
