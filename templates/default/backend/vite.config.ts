/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "~encore": path.resolve(dirname, "./encore.gen"),
    },
  },
  test: {
    environment: "node",
    // VS Code's Vitest extension is more reliable with serial files.
    // CLI and CI use `encore test --fileParallelism=true` to override this.
    fileParallelism: false,
    include: ["**/*.test.ts"],
  },
});
