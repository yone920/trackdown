import { z } from "zod";
import { CATEGORIES } from "../../db/exercises.js";
import { MEASURE_IDS } from "../goals/measures.js";

// The fusion schemas. Two of them, for one reason worth knowing before reading further.
//
// PUBLIC — `FusionResultSchema`: one *part* of what /api/log/analyze returns, what one
// confirm card renders, and what /api/log/confirm accepts back after the user's edits. A
// discriminated union, because the input classifier's job is to *route*
// (docs/concept-v2.md §Goals: "log · goal · constraint · preference · coach context").
// One part is one of those things — but one sentence is not necessarily one part:
// "ate two eggs, ran 5k, weighed in at 181" is three, and the analyzer returns all three
// (see `more_kinds` on `FusionRouteOutputSchema` below).
//
// MODEL-FACING — `FusionRouteOutputSchema`, the per-kind detail schemas, and
// `GoalDetailOutputSchema`: what is actually sent to the provider. They exist because
// Anthropic compiles a structured-output schema into a decoding grammar and refuses one
// that gets too big ("The compiled grammar is too large"): the eight-branch public union
// does not compile, on Haiku or Sonnet, and it is 8.9 KB. So the model is asked for a
// leaner shape and the service widens it back (see {@link toFusionResult}):
//   * six branches, not eight — constraint / preference / coach_context share one
//     `statement` branch with a `scope`, since they have the same shape anyway;
//   * a goal is routed as a title only, and a constraint/preference as its text; the spec
//     and the plan fields come from a second, focused call. Those two are stated maybe
//     once a month; logging a workout or a meal is the hot path and stays one call. The
//     spec's *timeline* is not asked for at all — WP4 projects it from the user's own
//     facts at the safe rates (services/goals/proposal.ts), because a date is arithmetic
//     and the row, the confirm card and the Goals screen all have to show the same one.
//   * `photo_fields: string[]` instead of a per-field source object — the same fact ("this
//     came off the photo") in one array node instead of seven anyOf nodes.
// Fields the catalogue derives on save (category, muscle_groups) are not asked for at all.
//
// **The ceiling is a field count, not a byte count, and the byte pin never measured the
// right bytes.** `fusion.test.ts` weighs `z.toJSONSchema(...)`; what the provider actually
// receives is `zodOutputFormat(...)`, which is a different and larger document — the SDK
// rewrites bounds and enums into `description` strings and hoists shared shapes into
// `$defs`. Adding `equipment` to the routing union was refused at *fewer* JSON-schema bytes
// than the shape that shipped, and stayed refused when the same field was moved, relaxed
// and slimmed; it compiled only once another field came off the union (the table on
// FusionRouteOutputSchema has every measurement). So: a model-facing schema can afford a
// new field only in trade for an old one, and **only the contract test knows**. Run
// `anthropic.fusion.contract.test.ts` before believing any change here.
//
// Two rules both shapes follow:
//   * Optional facts are `.nullable()`, never `.optional()`. Both providers' structured
//     outputs want every key present; "I did not read this off the photo" is a null, and a
//     missing key is a model that ignored the schema.
//   * Nothing here is trusted. The public schema validates the confirm body, so the user's
//     edits go through exactly the checks the model's answer did.

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const FieldConfidence = z.enum(CONFIDENCE_LEVELS);

/** Which evidence a field was read from. The confirm card shows it as a small marker. */
export const FIELD_SOURCES = ["photo", "text"] as const;
const FieldSource = z.enum(FIELD_SOURCES).nullable();

const ActivitySources = z
	.object({
		exercise: FieldSource,
		// Defaulted, not required: a phone built before 0012 sends a sources map without it,
		// and that is an old client rather than a malformed one.
		equipment: FieldSource.default(null),
		sets: FieldSource,
		reps: FieldSource,
		load_lb: FieldSource,
		duration_min: FieldSource,
		distance_mi: FieldSource,
		kcal: FieldSource,
	})
	.nullable();

const MealSources = z
	.object({
		description: FieldSource,
		kcal: FieldSource,
		protein_g: FieldSource,
		carbs_g: FieldSource,
		fat_g: FieldSource,
		fiber_g: FieldSource,
	})
	.nullable();

const WeightSources = z.object({ weight_lb: FieldSource }).nullable();

const kcal = z.number().int().min(0).max(20_000).nullable();
const grams = z.number().min(0).max(5000).nullable();

/**
 * "Was it a Chest-Supported Row?" — one tap that upgrades a best-guess movement to a
 * catalogue one. Never a question the user has to answer: the record is already saved (or
 * about to be), and this is an offer sitting beside it that can be ignored forever.
 *
 * Derived, not asked for: {@link file://./refine.ts} matches the words the model kept
 * against the catalogue this user's prompt already carried. Model-facing schemas have no
 * room for a field like this and it is not a judgement a model has to make twice.
 */
export const RefinementSchema = z.object({
	/** The chip's label, as shown. */
	question: z.string().trim().min(1).max(120),
	/** The catalogue name a tap would set `exercise` to. */
	exercise: z.string().trim().min(1).max(120),
});
export type Refinement = z.infer<typeof RefinementSchema>;

export const ActivityItemSchema = z.object({
	/**
	 * The exercise as the catalogue spells it when it is one we know ("Dumbbell Bench
	 * Press"), otherwise the user's own words. services/entries.ts re-checks the
	 * catalogue on save — the model's guess is a suggestion, not the last word.
	 */
	exercise: z.string().trim().min(1).max(120).nullable(),
	/**
	 * What the movement was done ON, when the user named it: "chest-supported row
	 * machine", "cable stack", "dumbbells". A separate fact from the movement, because
	 * someone who cannot name the exercise can very often name the machine — and because
	 * `delta_vs_last` keys on the movement, never on this.
	 */
	equipment: z.string().trim().min(1).max(80).nullable().default(null),
	/** One human line for the day view: "3 × 10 dumbbell bench at 45 lb". */
	description: z.string().trim().min(1).max(500),
	category: z.enum(CATEGORIES).nullable(),
	muscle_groups: z.array(z.string().trim().min(1).max(40)).max(12).nullable(),
	sets: z.number().int().min(0).max(100).nullable(),
	reps: z.number().int().min(0).max(1000).nullable(),
	load_lb: z.number().min(0).max(2000).nullable(),
	duration_min: z.number().int().min(0).max(1440).nullable(),
	distance_mi: z.number().min(0).max(1000).nullable(),
	kcal,
	confidence: FieldConfidence,
	sources: ActivitySources,
	/** An offer, never a question. Defaulted so a client that knows nothing of it still saves. */
	refine: RefinementSchema.nullable().default(null),
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const MealItemSchema = z.object({
	name: z.string().trim().min(1).max(200),
	kcal,
	protein_g: grams,
	carbs_g: grams,
	fat_g: grams,
	fiber_g: grams,
	serving_amount: z.string().trim().max(80).nullable(),
});
export type MealItem = z.infer<typeof MealItemSchema>;

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

/**
 * What the arithmetic gate had to say about a meal (services/fusion/arithmetic.ts). Present
 * only when the first reading did NOT add up — a meal that was consistent first time has
 * nothing to report and carries null.
 *
 *   "adjusted" — the one re-ask reconciled it, and these are the numbers before and after.
 *   "flagged"  — it still does not add up. The confidence was forced to low regardless of
 *                what the model claimed, and the card says so.
 *
 * Derived, never asked for: it is a fact about our own reading, so no model-facing schema
 * pays a byte for it. Defaulted, so a client written before this still confirms.
 */
export const MEAL_CONSISTENCY_OUTCOMES = ["adjusted", "restated", "flagged"] as const;
export const MealConsistencySchema = z.object({
	outcome: z.enum(MEAL_CONSISTENCY_OUTCOMES),
	/** The kcal as stated, and the 4P+4C+9F they implied, as the reading finally stands. */
	stated_kcal: z.number().nullable(),
	implied_kcal: z.number().nullable(),
});
export type MealConsistency = z.infer<typeof MealConsistencySchema>;

export const GOAL_KINDS = [
	"lose_fat",
	"gain_muscle",
	"build_strength",
	"improve_endurance",
	"maintain",
	"custom",
] as const;

/** How the measure should move. `maintain` is the standing-intention direction. */
export const GOAL_DIRECTIONS = ["decrease", "increase", "maintain", "at_least", "at_most"] as const;

const localDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
	.nullable();

export const GoalMetricSchema = z.object({
	/** Must name a calculator in services/goals/measures.ts — the app computes it or it is not a goal. */
	measure: z.enum(MEASURE_IDS),
	/** The muscle group or exercise a scoped measure is about ("shoulders", "Bench Press"). */
	scope: z.string().trim().min(1).max(80).nullable(),
	target: z.number().nullable(),
	unit: z.string().trim().max(20).nullable(),
	direction: z.enum(GOAL_DIRECTIONS),
	/** Free text as said: "0.5 % per week", "+5 lb every two weeks". */
	rate: z.string().trim().max(120).nullable(),
	by: localDate,
});
export type GoalMetric = z.infer<typeof GoalMetricSchema>;

export const GoalSpecSchema = z.object({
	kind: z.enum(GOAL_KINDS),
	title: z.string().trim().min(1).max(200),
	metrics: z.array(GoalMetricSchema).max(6),
	active_from: localDate,
	/** A standing intention with a window ("upper body for two months"); null = open-ended. */
	active_to: localDate,
});
export type GoalSpec = z.infer<typeof GoalSpecSchema>;

export const TRAINING_ENVIRONMENTS = ["gym", "home"] as const;

/**
 * Facts stated in the same breath as the goal. People do not set a goal in the abstract:
 * "I'm 212 lbs, my goal is 200, I work out 4 days a week, I'm 45, I go to the gym" is one
 * sentence with a goal and four facts in it, and throwing the facts away meant projecting
 * the goal from a stale weigh-in and asking for a profile the user had already filled in
 * out loud. The confirm saves each of these where it belongs — the weight as a weigh-in,
 * the rest on the profile with a `stated_at` date — before the goal is created.
 */
export const GoalFactsSchema = z.object({
	/** What they weigh today, when they said so. Saved as a weigh-in, not just a note. */
	current_weight_lb: z.number().positive().max(2000).nullable(),
	/** Sessions per week they train — profiles.training_days. */
	training_days: z.number().int().min(0).max(7).nullable(),
	/** Where they train — profiles.environment. */
	environment: z.enum(TRAINING_ENVIRONMENTS).nullable(),
	/** Their age in years; the profile stores a birth year, so the confirm subtracts. */
	age_years: z.number().int().min(5).max(120).nullable(),
});
export type GoalFacts = z.infer<typeof GoalFactsSchema>;

/**
 * The safe-rate projection (docs/concept-v2.md §Goals: "timelines are proposed, not
 * required"). When the user named a date of their own it is kept in `by` and
 * `realistic: false` says so, rather than being quietly corrected.
 */
export const ProposedTimelineSchema = z.object({
	by: localDate,
	rate: z.string().trim().max(120).nullable(),
	note: z.string().trim().max(400).nullable(),
	realistic: z.boolean().nullable(),
});

/** How long the user has been training, in their own three words. */
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/**
 * "I bench 165 for 3×5" — a load the user *states* for an exercise this log has never
 * seen. It is not a logged session and it never becomes one: it is what the coach
 * prescribes from until there is real history, and the moment there is, the log wins
 * (services/coach/rules.ts).
 */
export const ReferenceLoadSchema = z.object({
	exercise: z.string().trim().min(1).max(120),
	load_lb: z.number().min(0).max(2000),
	reps: z.number().int().min(1).max(100).nullable(),
});
export type ReferenceLoad = z.infer<typeof ReferenceLoadSchema>;

/** Where someone trains. `gym` is the overwhelming default; the rest are what people say. */
export const PLACE_KINDS = ["gym", "home", "travel", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Plan fields a spoken constraint or preference may set on the profile. */
export const ProfileFieldsSchema = z
	.object({
		diet_style: z.string().trim().max(80).nullable(),
		protein_g: z.number().int().min(0).max(1000).nullable(),
		carbs_max_g: z.number().int().min(0).max(2000).nullable(),
		training_days: z.number().int().min(0).max(7).nullable(),
		/**
		 * How long a normal session is (migration 0014). "I've only got 45 minutes in the
		 * gym" is a standing fact about how they train; "only 30 today" is coach context for
		 * one day and is NOT this — the prompt says so in as many words.
		 */
		session_minutes: z.number().int().min(10).max(240).nullable().default(null),
		/**
		 * Weekly cardio minutes they aim for (migration 0016). "I want 200 minutes of cardio
		 * a week" is a standing aim; "I'll get a long run in this week" is one week's plan and
		 * is NOT this. Null means nobody has said, and the WHO's 150 stands in *and says that
		 * it is standing in* — which is the whole reason this is a column rather than a
		 * constant.
		 */
		cardio_minutes_target: z.number().int().min(0).max(2000).nullable().default(null),
		environment: z.string().trim().max(80).nullable(),
		equipment: z.array(z.string().trim().min(1).max(60)).max(30).nullable(),
		eatback: z.enum(["none", "half", "all"]).nullable(),
		// The training background (migration 0011). Stated once, usually on day one, and
		// the reason a cold start does not have to assume a beginner.
		experience: z.enum(EXPERIENCE_LEVELS).nullable(),
		background: z.string().trim().max(600).nullable(),
		reference_loads: z.array(ReferenceLoadSchema).max(12).nullable(),
		// Where they train, when they NAME it (migration 0012). "I go to the gym" is
		// `environment`; "my gym is New Millennium" is a place, and a place is what the
		// equipment memory hangs off. Two flat fields rather than a nested object: the
		// same fact for a third of the grammar, on a call that has room either way.
		place_name: z.string().trim().max(120).nullable().default(null),
		place_kind: z.enum(PLACE_KINDS).nullable().default(null),
	})
	.nullable();
export type ProfileFields = z.infer<typeof ProfileFieldsSchema>;

/**
 * The app's doubt about one weigh-in (services/weightCheck.ts). Present ONLY when a reading
 * sits implausibly far from the recent average — a reading nobody had reason to doubt
 * carries null, which is the normal case.
 *
 * Derived, never asked for: it is a fact about the user's own history, not about the words
 * they said, so no model-facing schema pays a byte for it. Defaulted, so a client written
 * before this still confirms.
 */
export const WeighInCheckSchema = z.object({
	delta_lb: z.number(),
	avg_7d: z.number(),
	previous_lb: z.number().nullable(),
	previous_at: z.string().nullable(),
	/** The question the card asks, in words the user can actually check. */
	question: z.string().trim().min(1).max(200),
});
export type WeighInCheck = z.infer<typeof WeighInCheckSchema>;

export const FusionResultSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("activities"),
		items: z.array(ActivityItemSchema).min(1).max(20),
	}),
	z.object({
		kind: z.literal("meal"),
		description: z.string().trim().min(1).max(500),
		meal_type: z.enum(MEAL_TYPES).nullable(),
		kcal,
		protein_g: grams,
		carbs_g: grams,
		fat_g: grams,
		fiber_g: grams,
		/** The plate broken down, when the photo or the words support it. May be empty. */
		items: z.array(MealItemSchema).max(30),
		confidence: FieldConfidence,
		sources: MealSources,
		/** Null unless the arithmetic gate had something to say — see the schema's note. */
		consistency: MealConsistencySchema.nullable().default(null),
	}),
	z.object({
		kind: z.literal("weight"),
		weight_lb: z.number().positive().max(2000),
		confidence: FieldConfidence,
		sources: WeightSources,
		/**
		 * Null unless the app doubts this reading. When it is set the card asks before the
		 * number counts, and the row is saved low-confidence even after a yes — because a
		 * confirmed surprise is still a surprise, and everything that could congratulate the
		 * user on it reads that mark (migration 0020).
		 */
		check: WeighInCheckSchema.nullable().default(null),
	}),
	z.object({
		kind: z.literal("goal"),
		spec: GoalSpecSchema,
		proposed_timeline: ProposedTimelineSchema.nullable(),
		/**
		 * Defaulted rather than required: the Goals screen and every client written before
		 * this existed send a goal with no facts, and that is a goal with nothing stated
		 * alongside it, not a malformed one.
		 */
		facts: GoalFactsSchema.nullable().default(null),
	}),
	z.object({
		kind: z.literal("constraint"),
		text: z.string().trim().min(1).max(400),
		fields: ProfileFieldsSchema,
	}),
	z.object({
		kind: z.literal("preference"),
		text: z.string().trim().min(1).max(400),
		fields: ProfileFieldsSchema,
	}),
	z.object({
		kind: z.literal("coach_context"),
		text: z.string().trim().min(1).max(400),
	}),
	z.object({
		kind: z.literal("unclear"),
		/** The one question that would make this loggable. Shown as-is. */
		question: z.string().trim().min(1).max(300),
	}),
]);
export type FusionResult = z.infer<typeof FusionResultSchema>;
export type FusionKind = FusionResult["kind"];

// ---------------------------------------------------------------------------
// Model-facing schemas. Lean by necessity — see the note at the top of the file.
// ---------------------------------------------------------------------------

/**
 * Names of the fields this record read off a photo; everything else came from words.
 * Unbounded strings on purpose: {@link expandSources} only matches them against a fixed
 * list of field names, so a length bound buys nothing and costs grammar this schema does
 * not have to spare.
 */
const photoFields = z.array(z.string()).max(14);

/** Which of the photos sent with the message a part was read from. */
const photoIndexes = z.array(z.number().int()).max(4);

const ModelActivityItem = z.object({
	exercise: z.string().nullable(),
	/**
	 * The machine or kit, when they named one. It is on the ROUTING schema and not only on
	 * the roomy detail call because a workout is the hot path — one call — and "I don't know
	 * what the machine is called, it's the inclined one you lie on" is precisely the log
	 * this whole change is for. Measured: it takes the routing schema from 3580 to 3660-ish,
	 * inside the ceiling, and the contract test is what actually proved it compiles.
	 */
	equipment: z.string().nullable(),
	description: z.string(),
	// Plain numbers, not integers, and that is a grammar decision rather than a modelling
	// one. `z.number().int()` reaches the provider as an `anyOf` with a safe-integer bound
	// written out in a description — about 110 bytes each, six times over on this schema —
	// while a nullable number is `{"type":["number","null"]}`. The public schema still wants
	// whole numbers, so {@link whole} rounds on the way out.
	sets: z.number().nullable(),
	reps: z.number().nullable(),
	load_lb: z.number().nullable(),
	duration_min: z.number().nullable(),
	distance_mi: z.number().nullable(),
	kcal: z.number().nullable(),
	confidence: FieldConfidence,
});

const ModelMeal = z.object({
	kind: z.literal("meal"),
	description: z.string(),
	meal_type: z.enum(MEAL_TYPES).nullable(),
	kcal: z.number().nullable(),
	protein_g: z.number().nullable(),
	carbs_g: z.number().nullable(),
	fat_g: z.number().nullable(),
	fiber_g: z.number().nullable(),
	items: z.array(
		z.object({
			name: z.string(),
			kcal: z.number().nullable(),
			protein_g: z.number().nullable(),
			carbs_g: z.number().nullable(),
			fat_g: z.number().nullable(),
			fiber_g: z.number().nullable(),
			serving_amount: z.string().nullable(),
		})
	).max(30),
	confidence: FieldConfidence,
});

/** constraint, preference and coach_context are one shape; `scope` says which it is. */
export const STATEMENT_SCOPES = ["constraint", "preference", "coach_context"] as const;

export const FusionRouteSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("activities"), items: z.array(ModelActivityItem).min(1).max(20) }),
	ModelMeal,
	z.object({ kind: z.literal("weight"), weight_lb: z.number(), confidence: FieldConfidence }),
	// The routing decision only; the spec comes from a second call (GoalDetailOutputSchema).
	z.object({ kind: z.literal("goal"), title: z.string() }),
	// The plan fields a constraint or preference sets come from a second call too: seven
	// heterogeneous nullable fields cost about a kilobyte of grammar here, which is the
	// difference between a schema the provider compiles and one it refuses.
	z.object({ kind: z.literal("statement"), scope: z.enum(STATEMENT_SCOPES), text: z.string() }),
	z.object({ kind: z.literal("unclear"), question: z.string() }),
]);
export type FusionRoute = z.infer<typeof FusionRouteSchema>;

/** Six parts is more than any real sentence: three kinds, twice over, is already absurd. */
export const MAX_PARTS = 6;

/**
 * The kinds a segment can name — deliberately the same five the routing union uses, not the
 * seven the public union has. Naming constraint / preference / coach_context here instead of
 * `statement` was tried and the model ignored it: the routing rules right above it in the
 * same prompt call all three "statement", so that is the word it answers with. The scope
 * comes back from the statement's own follow-up call instead, where there is room for it.
 */
export const SEGMENT_KINDS = ["activities", "meal", "weight", "goal", "statement"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/**
 * Wrapped in an object because structured outputs want an object at the root — a bare
 * union is not a JSON-schema root either provider accepts.
 *
 * One input is not one kind: "ate two eggs, ran 5k, weighed in at 181" is a meal, an
 * activity and a weigh-in, and the single-`result` shape used to drop two of them. So the
 * router answers with the FIRST thing they said, in full, plus `more_kinds` — the bare list
 * of what else is in there, in the order they said it. Each of those is then filled in by a
 * focused call carrying only its own kind's schema.
 *
 * **`more_kinds` is a list of enum values and nothing else, and that is not a style
 * choice.** Anthropic compiles this into a decoding grammar and refuses one over a limit
 * that is *not* a byte count and is not monotonic in one either. Measured against the live
 * API while fitting `equipment` in — every row a request that was actually sent:
 *
 *   OK    the union as it shipped, 10 fields on the activity item
 *   FAIL  the same + `equipment` on the item                 (fewer bytes, one more field)
 *   FAIL  the same + `equipment`, with `photo_fields` moved off the item onto the branch
 *   FAIL  the same + `equipment`, with the item's integers relaxed to plain numbers
 *   OK    the same + `equipment`, with `photo_fields` hoisted OUT of all three branches
 *
 * The pattern the failures make is that **one more field anywhere in this union is one too
 * many**, wherever it sits and however few bytes it costs, so a field can only be added by
 * taking one out. `photo_fields` was the one to take: it was three copies of the same fact
 * (the meal branch's, the weight branch's, and one per activity item) answering a question
 * that is about the whole log — which photo a *fact* was read off, when there is one set of
 * photos and one message. Hoisting it here is a net −2 fields on the union and pays for
 * `equipment` with room to spare.
 *
 * The cost, stated plainly: within one activities log every item now shares one photo
 * attribution. "Load from the photo" was never really per-exercise anyway — a photographed
 * machine belongs to the log — and the focused per-kind calls keep their own `photo_fields`
 * where there is room for it.
 *
 * A follow-up call is given the whole original message anyway, so a quoted segment text
 * would have told it nothing it could not read for itself; which photos a part was read
 * from is asked of the follow-up instead, where there is room (`photo_indexes` below).
 */
export const FusionRouteOutputSchema = z.object({
	result: FusionRouteSchema,
	more_kinds: z.array(z.enum(SEGMENT_KINDS)).max(MAX_PARTS - 1),
	/** Which fields in `result` were read off a photo — one answer for the whole log. */
	photo_fields: photoFields,
});
export const FUSION_ROUTE_SCHEMA_NAME = "fusion_result";

// --- The focused per-kind calls that fill in the rest of a mixed input. One branch each,
// --- so each of these is a fraction of the routing schema's grammar and has room for the
// --- photo claim the routing schema cannot afford.

export const ActivitiesDetailOutputSchema = z.object({
	items: z.array(ModelActivityItem).min(1).max(20),
	photo_fields: photoFields,
	photo_indexes: photoIndexes,
});
export const ACTIVITIES_DETAIL_SCHEMA_NAME = "activities";

/**
 * What a told change did to an activities record. "amend" is the ordinary answer — the
 * fields of the record, corrected. "split" is the one this schema exists for.
 *
 * The field report (2026-09-01): the user logged "4 sets of 10 at 85, the last two sets I
 * reduced to 70". The CREATE path splits that correctly now (the GROUPING rule in
 * prompt.ts). The CORRECTION path could not: told the same story about one saved record,
 * the model had nowhere to put a second load, so it wrote "2 sets at 85, 2 sets at 70"
 * into the DESCRIPTION and left sets=4, load=null — a sentence where two records should
 * have been, and a row that still claimed four sets at no weight at all.
 *
 * A record can only carry one load, so a load that changed partway through the sets is
 * two records or it is nothing.
 */
export const ACTIVITY_REVISION_MODES = ["amend", "split"] as const;
export type ActivityRevisionMode = (typeof ACTIVITY_REVISION_MODES)[number];

/**
 * The revision call's shape for an activities part. It is the detail schema plus one enum,
 * and `revision_mode` is **FIRST on purpose**: structured output is decoded field by field
 * in schema order, so a mode declared after the items it governs would be chosen to fit
 * items already written rather than deciding what to write. The coach's own revision schema
 * puts its mode first for the same reason (services/coach/schema.ts).
 *
 * One enum is what this costs, on a single-branch schema with room — unlike the routing
 * union, where one more field anywhere is one too many (see FusionRouteOutputSchema).
 * `anthropic.fusion.contract.test.ts` is the gate, as always.
 */
export const ActivitiesRevisionOutputSchema = z.object({
	revision_mode: z.enum(ACTIVITY_REVISION_MODES),
	items: z.array(ModelActivityItem).min(1).max(20),
	photo_fields: photoFields,
	photo_indexes: photoIndexes,
});
export const ACTIVITIES_REVISION_SCHEMA_NAME = "activities_revision";

export const MealDetailOutputSchema = ModelMeal.omit({ kind: true }).extend({
	photo_fields: photoFields,
	photo_indexes: photoIndexes,
});
export const MEAL_DETAIL_SCHEMA_NAME = "meal";

export const WeightDetailOutputSchema = z.object({
	weight_lb: z.number(),
	confidence: FieldConfidence,
	photo_fields: photoFields,
	photo_indexes: photoIndexes,
});
export const WEIGHT_DETAIL_SCHEMA_NAME = "weigh_in";

/**
 * A constraint, preference or coach context said alongside something else. It carries its
 * own `scope` and `text` because the router named only the kind — unlike the routing path,
 * where the statement branch already quoted both and only the plan fields were missing.
 * `fields` is ignored for a coach context, which changes no plan.
 */
export const StatementDetailOutputSchema = z.object({
	scope: z.enum(STATEMENT_SCOPES),
	text: z.string(),
	fields: ProfileFieldsSchema,
});
export const STATEMENT_DETAIL_SCHEMA_NAME = "statement";

export const GoalDetailOutputSchema = z.object({
	spec: z.object({
		kind: z.enum(GOAL_KINDS),
		title: z.string(),
		metrics: z.array(
			z.object({
				measure: z.enum(MEASURE_IDS),
				scope: z.string().nullable(),
				target: z.number().nullable(),
				unit: z.string().nullable(),
				direction: z.enum(GOAL_DIRECTIONS),
				rate: z.string().nullable(),
				by: z.string().nullable(),
			})
		).max(6),
		active_to: z.string().nullable(),
	}),
	// Four flat nullable scalars — about 250 bytes of grammar on a schema that had a
	// kilobyte of headroom. fusion.test.ts pins the size so the next field has to measure.
	facts: z.object({
		current_weight_lb: z.number().nullable(),
		training_days: z.number().int().nullable(),
		environment: z.enum(TRAINING_ENVIRONMENTS).nullable(),
		age_years: z.number().int().nullable(),
	}),
});
export const GOAL_DETAIL_SCHEMA_NAME = "goal_spec";

/** The second call on the constraint / preference path: which plan fields were stated. */
export const PlanFieldsOutputSchema = z.object({ fields: ProfileFieldsSchema });
export const PLAN_FIELDS_SCHEMA_NAME = "plan_fields";

/** What a focused follow-up call produced, if one was needed. */
export interface FusionDetail {
	goal?: z.infer<typeof GoalDetailOutputSchema>;
	fields?: ProfileFields;
	/**
	 * Which fields were read off a photo. It sits beside the record rather than on it since
	 * the routing schema had to give up three copies of this field to make room for
	 * `equipment` — see the note on FusionRouteOutputSchema.
	 */
	photoFields?: readonly string[];
}

// ---------------------------------------------------------------------------
// Widening the model's answer back to the public shape.
// ---------------------------------------------------------------------------

/** Which fields each kind can carry a source for, in the order the card shows them. */
const SOURCE_FIELDS = {
	activity: ["exercise", "equipment", "sets", "reps", "load_lb", "duration_min", "distance_mi", "kcal"],
	meal: ["description", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
	weight: ["weight_lb"],
} as const;

/**
 * `photo_fields: ["load_lb"]` on a record → `{ load_lb: "photo", sets: "text", … }`.
 * A field the model left null has no source: nothing read it anywhere.
 */
export function expandSources<Field extends string>(
	fields: readonly Field[],
	photoFieldNames: readonly string[],
	values: Record<string, unknown>
): Record<Field, "photo" | "text" | null> {
	const photo = new Set(photoFieldNames.map((name) => name.trim().toLowerCase()));
	const sources = {} as Record<Field, "photo" | "text" | null>;
	for (const field of fields) {
		const value = values[field];
		sources[field] = value === null || value === undefined ? null : photo.has(field.toLowerCase()) ? "photo" : "text";
	}
	return sources;
}

/**
 * The model's stated facts, held to the public schema's bounds. The model-facing shape is
 * deliberately loose (fewer constraints, less grammar), so a nonsense age or a negative
 * weight is dropped here rather than failing the whole confirm later. All-null comes back
 * as null: "nothing was stated" is not the same as "four blanks were stated".
 */
function sanitizeGoalFacts(facts: unknown): GoalFacts | null {
	const parsed = GoalFactsSchema.safeParse(facts);
	const clean = parsed.success
		? parsed.data
		: GoalFactsSchema.parse({
				// Field by field, so one bad number does not cost the other three.
				current_weight_lb: pick(facts, "current_weight_lb", z.number().positive().max(2000)),
				training_days: pick(facts, "training_days", z.number().int().min(0).max(7)),
				environment: pick(facts, "environment", z.enum(TRAINING_ENVIRONMENTS)),
				age_years: pick(facts, "age_years", z.number().int().min(5).max(120)),
			});
	return Object.values(clean).every((value) => value === null) ? null : clean;
}

/**
 * The model-facing schemas ask for plain numbers where the public ones want integers — a
 * nullable number is a quarter of the grammar of a bounded integer (see ModelActivityItem).
 * So the translation rounds: "180.4 kcal" is 180, and three sets is three sets.
 */
function whole(value: number | null): number | null {
	return value === null ? null : Math.round(value);
}

function pick<T>(source: unknown, key: string, schema: z.ZodType<T>): T | null {
	const value = (source as Record<string, unknown> | null | undefined)?.[key];
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * The model's lean answer as the API's union. Everything the model was not asked for
 * (category, muscle_groups — the catalogue derives them on save) comes back null.
 */
export function toFusionResult(route: FusionRoute, detail: FusionDetail = {}): FusionResult {
	const goalDetail = detail.goal;
	const photoFieldNames = detail.photoFields ?? [];
	switch (route.kind) {
		case "activities":
			return {
				kind: "activities",
				items: route.items.map((item) => ({
					exercise: item.exercise,
					equipment: item.equipment,
					description: item.description,
					category: null,
					muscle_groups: null,
					sets: whole(item.sets),
					reps: whole(item.reps),
					load_lb: item.load_lb,
					duration_min: whole(item.duration_min),
					distance_mi: item.distance_mi,
					kcal: whole(item.kcal),
					confidence: item.confidence,
					sources: expandSources(SOURCE_FIELDS.activity, photoFieldNames, item),
					// Offered by services/fusion/refine.ts once the catalogue is to hand.
					refine: null,
				})),
			};

		case "meal":
			return {
				kind: "meal",
				description: route.description,
				meal_type: route.meal_type,
				kcal: whole(route.kcal),
				protein_g: route.protein_g,
				carbs_g: route.carbs_g,
				fat_g: route.fat_g,
				fiber_g: route.fiber_g,
				items: route.items.map((item) => ({ ...item, kcal: whole(item.kcal) })),
				confidence: route.confidence,
				sources: expandSources(SOURCE_FIELDS.meal, photoFieldNames, route),
				// Filled in by services/fusion/arithmetic.ts once the numbers have been
				// checked; the translation itself has no opinion about them.
				consistency: null,
			};

		case "weight":
			return {
				kind: "weight",
				weight_lb: route.weight_lb,
				confidence: route.confidence,
				sources: expandSources(SOURCE_FIELDS.weight, photoFieldNames, route),
				// Filled in by the route once the user's own recent readings are to hand;
				// the translation has no database and no business doubting anything.
				check: null,
			};

		case "goal": {
			if (!goalDetail) {
				// The router said "goal" but the follow-up call produced nothing usable.
				// Asking beats saving a goal with no measure in it.
				return { kind: "unclear", question: `What exactly do you want to reach for "${route.title}"?` };
			}
			return {
				kind: "goal",
				spec: {
					kind: goalDetail.spec.kind,
					title: goalDetail.spec.title || route.title,
					metrics: goalDetail.spec.metrics,
					active_from: null,
					active_to: goalDetail.spec.active_to,
				},
				// Filled in by services/goals/proposal.ts once the user's facts are to
				// hand; the analyzer itself has no database and no business guessing.
				proposed_timeline: null,
				facts: sanitizeGoalFacts(goalDetail.facts),
			};
		}

		case "statement":
			return route.scope === "coach_context"
				? { kind: "coach_context", text: route.text }
				: { kind: route.scope, text: route.text, fields: detail.fields ?? null };

		case "unclear":
			return { kind: "unclear", question: route.question };
	}
}
