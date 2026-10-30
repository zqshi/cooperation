import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    strictPort: true,
    port: 5173,
    proxy: {
      "/v1": process.env.WA_TEST_API_URL ?? "http://localhost:4100",
      "/healthz": process.env.WA_TEST_API_URL ?? "http://localhost:4100",
    },
  },
});
