import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // "server-only" throws outside a React Server Components bundle; tests import server modules directly.
      "server-only": path.resolve(__dirname, "__tests__/helpers/empty.ts"),
    },
  },
  // Vite 8 transforms with Oxc; tests render JSX with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    testTimeout: 15_000,
  },
});
