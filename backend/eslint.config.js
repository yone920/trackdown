import tseslint from "typescript-eslint";

// Minimal: type-aware defaults plus one boundary rule — only config/ reads process.env,
// so credentials are validated once at startup instead of at random call sites.
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
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		},
	}
);
