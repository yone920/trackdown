import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		env: { NODE_ENV: "test" },
		testTimeout: 30_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
