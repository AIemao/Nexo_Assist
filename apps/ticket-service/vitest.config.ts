import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    "include": ["src", "test", "vitest.config.ts"],
    passWithNoTests: true,
  },
});
