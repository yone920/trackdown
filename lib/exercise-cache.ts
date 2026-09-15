import type { QueryClient } from '@tanstack/react-query';

import type { ExerciseSheet } from './types';

// The exercise catalogue, kept between launches.
//
// A catalogue row is the most cacheable thing in this app: "Bench Press works chest and
// triceps and needs a barbell" is true for every account and does not change between
// releases. It was already `staleTime: Infinity` in memory, which made the *second* tap on
// a name instant and left the first one — the one somebody actually notices, standing in a
// gym on hotel wifi — waiting on a round trip.
//
// So the rows are written to a file and read back on launch. Deliberately small and
// deliberately hand-rolled: persisting the whole query cache would have meant three new
// packages and would have brought the day, the coach and the goals back from disk too,
// which is exactly what nobody wants — a stale day is a wrong day. This persists one query
// family, the one whose answers cannot go stale.
//
// **Every path here is best-effort.** A missing module, a full disk, a file written by an
// older build: all of them mean "no cache", and no cache means the screen fetches, which is
// what it did before. Nothing in this file may ever throw into a render.

/** Where the rows live. The cache directory: the system may reclaim it, and that is fine. */
const FILE_NAME = 'trackdown-exercise-cache.json';

/**
 * How many rows are kept. A catalogue row is a few hundred bytes; a hundred and fifty of
 * them is well under a hundred kilobytes and is more exercises than anybody logs in a year.
 */
const MAX_ENTRIES = 150;

/** Bumped when `ExerciseSheet` changes shape, which drops every row written before it. */
const VERSION = 1;

/** Prefetching a coach plan fetches eight rows in a second; one write covers them all. */
const WRITE_DEBOUNCE_MS = 1500;

type Stored = { version: number; sheets: Record<string, ExerciseSheet> };

let sheets: Record<string, ExerciseSheet> = {};
let writeTimer: ReturnType<typeof setTimeout> | null = null;

interface FileHandle {
  exists: boolean;
  textSync(): string;
  write(content: string): void;
  create(options?: { intermediates?: boolean; overwrite?: boolean }): void;
}

interface FileSystemModule {
  File: new (...parts: unknown[]) => FileHandle;
  Paths: { cache: unknown };
}

/**
 * The file system, resolved **once, at import**, and null on any host that does not have
 * one (jest, web). Resolved here rather than inside the write, because the write happens on
 * a timer and a `require` on a timer is a module loaded after everything else has gone
 * away — which under jest is an environment already torn down.
 */
const fileSystem: FileSystemModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system') as FileSystemModule;
  } catch {
    return null;
  }
})();

/** The one file, or null when there is nowhere to put it. */
function handle(): FileHandle | null {
  try {
    return fileSystem ? new fileSystem.File(fileSystem.Paths.cache, FILE_NAME) : null;
  } catch {
    return null;
  }
}

/** Reads the file into the query cache. Called once, from the root layout. */
export function hydrateExerciseCache(client: QueryClient): number {
  try {
    const file = handle();
    if (!file || !file.exists) return 0;
    const parsed = JSON.parse(file.textSync()) as Stored;
    if (!parsed || parsed.version !== VERSION || typeof parsed.sheets !== 'object') return 0;
    sheets = parsed.sheets;
    let count = 0;
    for (const [id, sheet] of Object.entries(sheets)) {
      // `setQueryData` only ever *seeds*: a query already holding a fresher row keeps it.
      if (client.getQueryData(['exercise', id]) === undefined) {
        client.setQueryData(['exercise', id], sheet);
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Files one fetched row. Debounced, because prefetching a coach plan fetches eight of them
 * in a second and eight writes of the same file is seven writes too many.
 */
export function rememberExercise(sheet: ExerciseSheet | null | undefined): void {
  if (!sheet?.id) return;
  // Re-inserted rather than updated in place, so the object's own key order is the
  // least-recently-seen order and the trim below drops the oldest.
  delete sheets[sheet.id];
  sheets[sheet.id] = sheet;
  const keys = Object.keys(sheets);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete sheets[key];

  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushExerciseCache, WRITE_DEBOUNCE_MS);
  // Node's timers keep a process alive; React Native's do not have `unref` at all. Under
  // jest the difference is a worker that will not exit, so it is called when it is there.
  (writeTimer as unknown as { unref?: () => void }).unref?.();
}

/** Writes what is held. Exported so a test can drive it without waiting on a timer. */
export function flushExerciseCache(): void {
  writeTimer = null;
  try {
    const file = handle();
    if (!file) return;
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify({ version: VERSION, sheets } satisfies Stored));
  } catch {
    // No cache is a state, not an error (see the note at the top of this file).
  }
}

/** For tests: forget everything held in memory. Does not touch the file. */
export function resetExerciseCache(): void {
  sheets = {};
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
}
