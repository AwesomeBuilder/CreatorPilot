import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir),
    },
  },
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    include: ["**/*.test.ts"],
  },
});
