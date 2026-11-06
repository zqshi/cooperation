import { defineConfig } from "@playwright/test";

// Frontend contract tests use explicit HTTP fixtures; no database or real account.
export default defineConfig({
  testDir: "tests/console",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:16273", headless: true, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm --filter @workagent/console exec vite --host 127.0.0.1 --port 16273",
    url: "http://127.0.0.1:16273",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
