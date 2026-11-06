import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/portal-ui",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:16274", headless: true },
  webServer: {
    command: "pnpm --filter @workagent/user-portal exec vite --host 127.0.0.1 --port 16274",
    url: "http://127.0.0.1:16274",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
