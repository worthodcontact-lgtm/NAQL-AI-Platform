import { defineConfig } from "vitest/config";

/**
 * The API test suite writes real rows to PostgreSQL. Running files in parallel
 * makes count-based assertions (dashboard metrics, last Super Admin) race
 * against other files, so the integration suite is intentionally serial.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
