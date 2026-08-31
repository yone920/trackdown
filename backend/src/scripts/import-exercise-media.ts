import { pathToFileURL } from "node:url";
import pg from "pg";
import { config } from "../config/index.js";
import { createLocalExerciseMediaStore, exerciseMediaRoot } from "../adapters/storage/exerciseMedia.js";
import { describeTarget } from "../db/client.js";
import { matchCatalog, parseDataset, type CatalogRow, type DatasetExercise } from "../services/exerciseMedia.js";
import type { ExerciseMediaStore } from "../ports/exerciseMedia.js";

// `npm run import-exercise-media` — the one-time (and then idempotent) import of the
// exercise illustrations.
//
// Where they come from: **free-exercise-db** (github.com/yuhonas/free-exercise-db), which
// is Unlicense — public domain — and ships both the JSON and the photographs in the repo.
// Both are pinned to a commit below, so the same command a year from now imports the same
// pictures. Nothing is hot-linked: the frames are copied into our own storage and served
// by GET /api/exercises/:id/media/:n, so a phone showing an exercise sheet never talks to
// GitHub, and the dataset disappearing costs us nothing.
//
// Only *matched* images are downloaded — about 200 files, ~100 KB each — and only ones
// not already on disk, which is what makes this safe to run at every container start:
// with the media volume already populated it does nothing at all, and if the network is
// down it warns and the app runs with name-only exercise sheets.
//
// Matching lives in services/exerciseMedia.ts and is the part with tests.

const DATASET_COMMIT = "a859101d633a01c4a1a920d6a8ce41dabba0705f";
const DATASET_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${DATASET_COMMIT}/dist/exercises.json`;
const IMAGE_BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${DATASET_COMMIT}/exercises/`;

/** Two frames — a start and an end position — is what the sheet draws. */
const FRAMES_PER_EXERCISE = 2;
/** Politeness, and a bound on how long a container start can be delayed. */
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 30_000;
/** A dataset frame is ~100 KB; anything this size is not a photograph. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type Queryable = pg.Pool | pg.PoolClient | pg.Client;

export interface ImportOptions {
	db: Queryable;
	media: ExerciseMediaStore;
	/** Injected in tests — no test in this repo may touch the network. */
	fetchDataset?: () => Promise<unknown>;
	/** Takes a repo-relative image path ("Barbell_Squat/0.jpg") and answers with its bytes. */
	fetchImage?: (imagePath: string) => Promise<Buffer>;
	/** Re-run the match and fill any gaps even though media is already present. */
	force?: boolean;
	log?: (message: string) => void;
}

export interface ImportReport {
	/** True when the run stopped early because the media was already there. */
	skipped: boolean;
	total: number;
	matched: number;
	/** matched / total, 0–1. */
	matchRate: number;
	unmatched: string[];
	downloaded: number;
	/** Frames that were already on disk from an earlier run. */
	alreadyPresent: number;
	/** Frames whose download failed; the exercise keeps whatever it does have. */
	failed: number;
	bytesDownloaded: number;
}

async function fetchJsonOverHttp(url: string): Promise<unknown> {
	const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
	return (await res.json()) as unknown;
}

async function fetchImageOverHttp(imagePath: string): Promise<Buffer> {
	const url = IMAGE_BASE + imagePath.split("/").map(encodeURIComponent).join("/");
	const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.byteLength === 0) throw new Error(`${url} returned no bytes`);
	if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`${url} is ${bytes.byteLength} bytes — not a frame`);
	return bytes;
}

/** Runs `work` over `items`, at most `limit` at a time, in order of completion. */
async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await work(item);
		}
	});
	await Promise.all(workers);
}

/**
 * Imports the illustrations. Idempotent: a frame already on disk is never fetched again,
 * and the catalogue columns are rewritten to the same values. Nothing is ever deleted —
 * an exercise that stops matching keeps the pictures it has.
 */
export async function importExerciseMedia({
	db,
	media,
	fetchDataset = () => fetchJsonOverHttp(DATASET_URL),
	fetchImage = fetchImageOverHttp,
	force = false,
	log = console.log,
}: ImportOptions): Promise<ImportReport> {
	const empty: ImportReport = {
		skipped: false,
		total: 0,
		matched: 0,
		matchRate: 0,
		unmatched: [],
		downloaded: 0,
		alreadyPresent: 0,
		failed: 0,
		bytesDownloaded: 0,
	};

	const { rows: catalog } = await db.query<CatalogRow>(
		`SELECT id, name, aliases FROM exercise_catalog ORDER BY name`
	);
	if (catalog.length === 0) {
		log("⚠️  The exercise catalogue is empty — run db:migrate first. Nothing to import.");
		return empty;
	}

	// The container runs this on every start (see the Dockerfile's CMD). With the media
	// volume already populated that must cost nothing — not even the dataset download —
	// so an earlier successful run short-circuits it. `--force` is how you pick up new
	// aliases without wiping the volume.
	if (!force) {
		const { rows } = await db.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM exercise_catalog WHERE media_count > 0`
		);
		const done = Number(rows[0]?.count ?? 0);
		if (done > 0) {
			log(`⏭️  ${done} exercises already have illustrations — nothing to do (use --force to re-import).`);
			return { ...empty, skipped: true, total: catalog.length, matched: done };
		}
	}

	log(`⬇️  Fetching free-exercise-db (${DATASET_COMMIT.slice(0, 7)})…`);
	const dataset = parseDataset(await fetchDataset());
	const { matches, unmatched, total } = matchCatalog(catalog, dataset);
	const matchRate = total === 0 ? 0 : matches.size / total;
	log(`🔗 Matched ${matches.size} of ${total} catalogue exercises (${Math.round(matchRate * 100)}%).`);

	let downloaded = 0;
	let alreadyPresent = 0;
	let failed = 0;
	let bytesDownloaded = 0;
	/** exercise id → how many frames it ended up with. */
	const frames = new Map<string, number>();

	const jobs: { exerciseId: string; entry: DatasetExercise; index: number; imagePath: string }[] = [];
	for (const [exerciseId, entry] of matches) {
		frames.set(exerciseId, 0);
		entry.images.slice(0, FRAMES_PER_EXERCISE).forEach((imagePath, index) => {
			jobs.push({ exerciseId, entry, index, imagePath });
		});
	}

	await inParallel(jobs, CONCURRENCY, async ({ exerciseId, index, imagePath }) => {
		if (await media.has(exerciseId, index)) {
			alreadyPresent += 1;
			frames.set(exerciseId, (frames.get(exerciseId) ?? 0) + 1);
			return;
		}
		try {
			const bytes = await fetchImage(imagePath);
			bytesDownloaded += await media.put(exerciseId, index, bytes);
			downloaded += 1;
			frames.set(exerciseId, (frames.get(exerciseId) ?? 0) + 1);
		} catch (error) {
			// One missing frame is a sheet with one picture, not a failed deploy.
			failed += 1;
			log(`⚠️  ${imagePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	// One statement: the columns and the frame count that was actually achieved. Written
	// after the downloads so `media_count` never promises a file that is not there.
	const payload = [...matches].map(([exerciseId, entry]) => ({
		id: exerciseId,
		instructions: entry.instructions,
		media_count: frames.get(exerciseId) ?? 0,
		source_slug: entry.id,
		level: entry.level,
	}));
	if (payload.length > 0) {
		await db.query(
			`UPDATE exercise_catalog SET
				instructions = ARRAY(SELECT jsonb_array_elements_text(e->'instructions')),
				media_count = (e->>'media_count')::int,
				source_slug = e->>'source_slug',
				level = e->>'level',
				updated_at = NOW()
			   FROM jsonb_array_elements($1::jsonb) AS e
			  WHERE exercise_catalog.id = (e->>'id')::uuid`,
			[JSON.stringify(payload)]
		);
	}

	log(
		`🖼️  ${downloaded} frames downloaded, ${alreadyPresent} already there, ${failed} failed ` +
			`(${(bytesDownloaded / 1024 / 1024).toFixed(1)} MB).`
	);
	if (unmatched.length > 0) {
		log(`   No illustration for: ${unmatched.join(", ")}`);
	}

	return { skipped: false, total, matched: matches.size, matchRate, unmatched, downloaded, alreadyPresent, failed, bytesDownloaded };
}

async function main(): Promise<void> {
	const force = process.argv.includes("--force");
	const media = createLocalExerciseMediaStore({ root: exerciseMediaRoot(config.evidence.dir) });
	console.log(`🏋️  Importing exercise illustrations into ${describeTarget(config.databaseUrl)} → ${media.describe}`);
	const client = new pg.Client({ connectionString: config.databaseUrl });
	await client.connect();
	try {
		const report = await importExerciseMedia({ db: client, media, force });
		if (!report.skipped) {
			const usage = await media.usage();
			console.log(
				`✅ ${report.matched}/${report.total} illustrated (${Math.round(report.matchRate * 100)}%); ` +
					`${usage.files} files, ${(usage.bytes / 1024 / 1024).toFixed(1)} MB on disk.`
			);
		}
	} finally {
		await client.end();
	}
}

// Only when run as a command: the tests import `importExerciseMedia` and drive it with
// their own fakes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error("❌ Importing the exercise illustrations failed:", error);
		process.exit(1);
	});
}
