import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: __dirname,
    environment: "jsdom",
    include: ["src/**/*.spec.ts"],
  },
});
