// Three entries shaped exactly like free-exercise-db's `dist/exercises.json`, and the
// bytes that stand in for its photographs.
//
// **No test in this repo may touch the network**, so the importer is handed this instead
// of a fetch. Each entry is here to prove one matching rule against
// `data/exercises.json`:
//
//   * "Barbell Bench Press - Medium Grip" — the qualifier after " - " is dropped, and the
//     remainder ("barbell bench press") is an alias of our **Bench Press**.
//   * "Concentration Curls" — a plural last word is singularised onto our
//     **Concentration Curl**.
//   * "Air Bike" — a floor crunch that happens to share a name with our **Assault Bike**'s
//     alias. It must NOT match; it is the reason AMBIGUOUS_SOURCE_NAMES exists.
//
//   * "Chest And Front Of Shoulder Stretch" — a `stretching` entry, matched onto our
//     **Chest Stretch** through an alias. The finisher's rows were name-only until the
//     stretches were seeded (2026-09-01); this is the rule that gives them pictures.
//
//   * "Bench Press - Powerlifting" — a correct match with the wrong *photographs* (an
//     empty bar). It is what PREFERRED_SOURCE_NAMES exists to overrule.
//
// A sixth, "Pretend Machine Fly", matches nothing at all: the miss list has to be real.

export const DATASET_FIXTURE = [
	{
		id: "Barbell_Bench_Press_-_Medium_Grip",
		name: "Barbell Bench Press - Medium Grip",
		force: "push",
		level: "beginner",
		mechanic: "compound",
		equipment: "barbell",
		primaryMuscles: ["chest"],
		secondaryMuscles: ["shoulders", "triceps"],
		instructions: [
			"Lie back on a flat bench holding the bar with a medium width grip.",
			"Lower the bar to your middle chest, then press it back to the start.",
		],
		category: "strength",
		images: ["Barbell_Bench_Press_-_Medium_Grip/0.jpg", "Barbell_Bench_Press_-_Medium_Grip/1.jpg"],
	},
	{
		id: "Concentration_Curls",
		name: "Concentration Curls",
		force: "pull",
		level: "intermediate",
		mechanic: "isolation",
		equipment: "dumbbell",
		primaryMuscles: ["biceps"],
		secondaryMuscles: ["forearms"],
		instructions: ["Sit with the dumbbell between your legs.", "Curl it up, keeping the elbow still."],
		category: "strength",
		images: ["Concentration_Curls/0.jpg", "Concentration_Curls/1.jpg"],
	},
	{
		id: "Air_Bike",
		name: "Air Bike",
		force: "pull",
		level: "beginner",
		mechanic: "compound",
		equipment: "body only",
		primaryMuscles: ["abdominals"],
		secondaryMuscles: [],
		instructions: ["Lie flat and bring the opposite knee and elbow together."],
		category: "strength",
		images: ["Air_Bike/0.jpg", "Air_Bike/1.jpg"],
	},
	{
		// The entry the general rules would pick for our Bench Press: its derived key
		// ("bench press", the qualifier after " - " dropped) is our own name, and it comes
		// first here as it does in the dataset. Its photographs are of an EMPTY bar, which
		// is why PREFERRED_SOURCE_NAMES overrules it (field report 2026-09-01).
		id: "Bench_Press_-_Powerlifting",
		name: "Bench Press - Powerlifting",
		force: "push",
		level: "advanced",
		mechanic: "compound",
		equipment: "barbell",
		primaryMuscles: ["chest"],
		secondaryMuscles: ["shoulders", "triceps"],
		instructions: ["Set up with a hard arch and the bar over the eyes."],
		category: "powerlifting",
		images: ["Bench_Press_-_Powerlifting/0.jpg", "Bench_Press_-_Powerlifting/1.jpg"],
	},
	{
		id: "Chest_And_Front_Of_Shoulder_Stretch",
		name: "Chest And Front Of Shoulder Stretch",
		force: "static",
		level: "beginner",
		mechanic: null,
		equipment: "other",
		primaryMuscles: ["chest"],
		secondaryMuscles: ["shoulders"],
		instructions: ["Stand in a doorway with the forearm on the frame.", "Turn away until the chest opens."],
		category: "stretching",
		images: ["Chest_And_Front_Of_Shoulder_Stretch/0.jpg", "Chest_And_Front_Of_Shoulder_Stretch/1.jpg"],
	},
	{
		id: "Pretend_Machine_Fly",
		name: "Pretend Machine Fly",
		force: "push",
		level: "beginner",
		mechanic: "isolation",
		equipment: "machine",
		primaryMuscles: ["chest"],
		secondaryMuscles: [],
		instructions: ["This movement is not in our catalogue under any name."],
		category: "strength",
		images: ["Pretend_Machine_Fly/0.jpg", "Pretend_Machine_Fly/1.jpg"],
	},
];

/** Stand-in bytes; the tests assert these come back out of the store byte for byte. */
export function fakeFrame(imagePath: string): Buffer {
	return Buffer.from(`jpeg-bytes-for:${imagePath}`, "utf8");
}
