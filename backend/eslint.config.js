import tseslint from "typescript-eslint";

// Minimal: type-aware defaults plus the two architecture boundaries from
// docs/build-plan.md §Architecture rules.
//   1. Only config/ reads process.env, so credentials are validated once at startup
//      instead of at random call sites.
//   2. Only adapters/ import a provider SDK. Routes and services take a port
//      (src/ports/*) and container.ts picks the implementation — that is what makes
//      "swap a provider = one env var" true rather than aspirational.
const SDK_BOUNDARY_MESSAGE =
	"Provider SDKs belong in src/adapters/** only. Depend on a port from src/ports/ and let src/container.ts choose the adapter.";

export default tseslint.config(
	{ ignores: ["dist/**", "node_modules/**"] },
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		ignores: ["src/config/**", "src/scripts/**"],
		rules: {
			"no-restricted-syntax": [
				"error",
				{
					selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
					message: "Read configuration from src/config/index.ts, not process.env.",
				},
			],
			// ignoreRestSiblings: omitting a field by destructuring it out (`const { facts,
			// ...rest } = view`) is the readable way to drop one key from a response, and
			// naming the thing you are dropping is the point of it.
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
			],
		},
	},
	{
		files: ["src/**/*.ts"],
		ignores: ["src/adapters/**"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{ name: "@anthropic-ai/sdk", message: SDK_BOUNDARY_MESSAGE },
						{ name: "openai", message: SDK_BOUNDARY_MESSAGE },
						{ name: "nodemailer", message: SDK_BOUNDARY_MESSAGE },
					],
					// The SDKs' subpath exports (`@anthropic-ai/sdk/helpers/zod`, …) are the
					// same dependency by another name.
					patterns: [
						{
							group: ["@anthropic-ai/sdk/*", "openai/*", "nodemailer/*"],
							message: SDK_BOUNDARY_MESSAGE,
						},
					],
				},
			],
		},
	}
);
