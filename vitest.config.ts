import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@gladiators/combat-sim": fileURLToPath(
        new URL("./packages/combat-sim/src/index.ts", import.meta.url),
      ),
      "@gladiators/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
