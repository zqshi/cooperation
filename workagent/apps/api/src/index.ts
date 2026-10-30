import { config } from "@workagent/config";
import { recoverStaleJobs } from "@workagent/core";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  await recoverStaleJobs();
  const app = await buildServer();
  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
  console.log(`WorkAgent API listening on http://localhost:${config.apiPort}`);

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
