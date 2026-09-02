import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INVALIDATED_AFTER_LOG } from '@/lib/queries';

// A correction invalidates everything that draws the corrected number.
//
// The way that rule goes wrong is by OMISSION, and silently: a new screen adds a query,
// nobody adds its root to the invalidation list, and that one surface serves a stale value
// for ever. It happened — a weigh-in corrected from 110 to 210 saved correctly, showed its
// audit line on the record card, and went on reading 110 in the Weigh-ins list, because
// `['weight', …]` was not on the list (field report 2026-09-02).
//
// So this test reads the source and holds the two lists against each other. It is a
// grep-with-an-assertion rather than a behavioural test, deliberately: the failure mode is
// a key that nobody thought about, and no amount of testing the keys we DID think about
// would have caught it.

/** Roots that are intentionally never invalidated by a log, each with its reason. */
const STATIC_ROOTS: Record<string, string> = {
  exercise: 'the catalogue is the same for everybody; nothing a user logs changes it',
};

function queryRootsInSource(): string[] {
  const source = readFileSync(join(__dirname, '..', 'lib', 'queries.ts'), 'utf8');
  const roots = new Set<string>();
  for (const match of source.matchAll(/queryKey:\s*\[\s*'([^']+)'/g)) roots.add(match[1]!);
  return [...roots].sort();
}

describe('invalidateAfterLog', () => {
  it('covers every query root the app registers', () => {
    const uncovered = queryRootsInSource().filter(
      (root) => !INVALIDATED_AFTER_LOG.includes(root as never) && !(root in STATIC_ROOTS),
    );
    // If this fails, a new query was added without deciding whether a log changes it.
    // Add its root to INVALIDATED_AFTER_LOG, or to STATIC_ROOTS with the reason it cannot.
    expect(uncovered).toEqual([]);
  });

  it('includes the weigh-ins list, which is the one that was missed', () => {
    expect(INVALIDATED_AFTER_LOG).toContain('weight');
  });

  it('finds the roots it claims to — the guard is worthless if the regex misses', () => {
    // Proves the scan is actually reading keys, so a passing test above means coverage
    // rather than an empty list matching an empty list.
    const roots = queryRootsInSource();
    expect(roots).toContain('weight');
    expect(roots).toContain('day');
    expect(roots).toContain('eating');
    expect(roots.length).toBeGreaterThan(8);
  });

  it('leaves the catalogue alone, on purpose and with a reason', () => {
    expect(INVALIDATED_AFTER_LOG).not.toContain('exercise');
    expect(STATIC_ROOTS.exercise).toBeTruthy();
  });
});
