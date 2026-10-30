import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  globalTeardown: "./scripts/browser-teardown.mts",
  retries: 0,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm exec tsx scripts/browser-server.mts",
    url: "http://127.0.0.1:16174",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
